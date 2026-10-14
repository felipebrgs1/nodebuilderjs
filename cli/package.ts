// `nodebuilder package <entry.tsx>`: packages an app for Linux distribution.
// Steps: native addon (prebuilt from npm, or built here) -> `bun build --compile` (one executable with
// the addon embedded) -> staging tree (/usr/bin, .desktop, icon) -> one artifact per target in dist/.
// System libraries (Wayland/X11, EGL/GLES, FreeType...) are declared as dependencies, never bundled.
import { $ } from "bun";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildAppImage } from "./package/appimage.js";
import { type AppInfo, type StagedFile, archOf } from "./package/common.js";
import { buildDeb } from "./package/deb.js";
import { buildNative, elfGlibc } from "./package/native.js";
import { buildRpm } from "./package/rpm.js";

/** Root of @nodebuilderjs/core: the framework checkout, or node_modules/@nodebuilderjs/core in an app. */
const FRAMEWORK = resolve(import.meta.dir, "..");
const TARGETS = ["appimage", "deb", "rpm", "tar"] as const;
type Target = (typeof TARGETS)[number];

const HELP = `uso: nodebuilder package <entrada.tsx> [opções]

  --name <nome>          nome do pacote/executável (padrão: name do package.json ou do arquivo)
  --title <texto>        nome exibido no menu de aplicativos
  --app-id <id>          app id Wayland/WM_CLASS (padrão: dev.nodebuilder.<nome>); se a <Window>
                         define appId, passe o mesmo valor
  --version <x.y.z>      padrão: version do package.json do app
  --summary <texto>      descrição curta (padrão: description do package.json)
  --description <texto>  descrição longa
  --icon <arquivo>       .svg ou .png 256x256 (padrão: ícone do nodebuilder)
  --license, --maintainer, --homepage
  --categories <lista>   categorias do .desktop (padrão: Utility;)
  --targets <lista>      ${TARGETS.join(",")} (padrão: todos)
  --native <modo>        prebuilt: binário do pacote @nodebuilderjs/<plataforma> (padrão em apps)
                         docker:   compila no Ubuntu 22.04, glibc 2.34+ (padrão no repositório do framework)
                         local:    compila nesta máquina (só roda com a glibc daqui ou mais nova)
  --out <dir>            padrão: dist`;

export async function packageCommand(argv: string[]) {
  const { values: opts, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      title: { type: "string" },
      "app-id": { type: "string" },
      version: { type: "string" },
      summary: { type: "string" },
      description: { type: "string" },
      icon: { type: "string" },
      license: { type: "string" },
      maintainer: { type: "string" },
      homepage: { type: "string" },
      categories: { type: "string" },
      targets: { type: "string", default: TARGETS.join(",") },
      native: { type: "string" },
      out: { type: "string", default: "dist" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (opts.help || positionals.length !== 1) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const pkgPath = resolve("package.json");
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : {};
  const entry = resolve(positionals[0]!);
  const rawName = opts.name ?? (pkg.name && !pkg.name.startsWith("@nodebuilderjs/") ? pkg.name : basename(entry, extname(entry)));
  const name = rawName.replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9+.-]/g, "-");
  const targets = opts.targets!.split(",").map((t) => t.trim()) as Target[];
  for (const t of targets) if (!TARGETS.includes(t)) throw new Error(`alvo desconhecido: ${t}`);

  const title = opts.title ?? name;
  const app: AppInfo = {
    name,
    title,
    appId: opts["app-id"] ?? `dev.nodebuilder.${name.replace(/[^a-z0-9]/g, "_")}`,
    version: opts.version ?? pkg.version ?? "0.1.0",
    summary: opts.summary ?? pkg.description ?? title,
    description: opts.description ?? opts.summary ?? pkg.description ?? `${title}, feito com nodebuilder.`,
    license: opts.license ?? pkg.license ?? "unknown",
    maintainer: opts.maintainer ?? ((await $`git config user.name`.nothrow().quiet().text()).trim() || "unknown"),
    homepage: opts.homepage ?? pkg.homepage ?? "",
    categories: opts.categories ?? "Utility;",
    arch: archOf(process.arch),
  };

  const out = resolve(opts.out!);
  const work = join(out, ".work", name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // ---- 1. native addon -------------------------------------------------------

  const target = `${process.platform}-${process.arch}`;
  const inFrameworkRepo = existsSync(join(FRAMEWORK, "native/core"));
  const hasDocker = inFrameworkRepo && (await $`docker info`.quiet().nothrow()).exitCode === 0;
  const nativeMode = opts.native ?? (!inFrameworkRepo ? "prebuilt" : hasDocker ? "docker" : "local");
  let addon: string;
  if (nativeMode === "prebuilt") {
    try {
      addon = createRequire(join(FRAMEWORK, "package.json")).resolve(`@nodebuilderjs/${target}/nodebuilder.node`);
    } catch {
      throw new Error(`@nodebuilderjs/${target} não está instalado; rode "bun install" (ou use --native docker|local no repositório do framework)`);
    }
    console.log(`• addon nativo pré-compilado (@nodebuilderjs/${target})`);
  } else if (nativeMode === "docker" || nativeMode === "local") {
    if (!inFrameworkRepo) throw new Error(`--native ${nativeMode} só funciona no repositório do framework (precisa de native/)`);
    console.log(nativeMode === "docker"
      ? "• addon nativo portável (Docker, Ubuntu 22.04)"
      : "• addon nativo local (exige a glibc desta máquina ou mais nova no destino)");
    addon = await buildNative(FRAMEWORK, nativeMode);
  } else {
    throw new Error(`--native deve ser prebuilt, docker ou local`);
  }
  const glibc = elfGlibc(new Uint8Array(readFileSync(addon)));
  if (glibc) console.log(`  glibc mínima exigida pelo addon: ${glibc}`);

  // ---- 2. single executable ----------------------------------------------------

  console.log("• executável único (bun build --compile)");
  const exe = join(work, name);
  const build = await Bun.build({
    entrypoints: [entry],
    compile: { outfile: exe },
    minify: true,
    define: { "process.env.NB_APP_ID": JSON.stringify(app.appId) },
    plugins: [
      {
        // src/runtime/native.ts names every candidate addon (local build and npm package, per platform);
        // embed only the chosen one and leave the rest as never-taken runtime requires.
        name: "nodebuilder-addon",
        setup(b) {
          b.onResolve({ filter: /nodebuilder\.node$/ }, (args) => {
            const fromNpm = args.path.startsWith("@nodebuilderjs/");
            const chosen =
              nativeMode === "prebuilt"
                ? fromNpm && args.path === `@nodebuilderjs/${target}/nodebuilder.node`
                : !fromNpm && args.path.endsWith(`/${target}/nodebuilder.node`);
            return chosen ? undefined : { path: args.path, external: true };
          });
        },
      },
    ],
  });
  if (!build.success) {
    for (const log of build.logs) console.error(log);
    process.exit(1);
  }
  chmodSync(exe, 0o755);

  // ---- 3. staging tree -----------------------------------------------------------

  const iconSrc = resolve(opts.icon ?? join(FRAMEWORK, "cli/package/icon.svg"));
  const iconExt = extname(iconSrc).toLowerCase();
  if (iconExt !== ".svg" && iconExt !== ".png") throw new Error("--icon precisa ser .svg ou .png");
  const iconDir = iconExt === ".svg" ? "scalable" : "256x256";

  const desktop = `[Desktop Entry]
Type=Application
Name=${app.title}
Comment=${app.summary}
Exec=${name}
Icon=${app.appId}
Terminal=false
Categories=${app.categories}
StartupWMClass=${app.appId}
`;
  writeFileSync(join(work, "app.desktop"), desktop);

  // Install layout shared by deb/rpm/tar; AppImage reuses it as its AppDir.
  const files: StagedFile[] = [
    { path: `/usr/bin/${name}`, source: exe, mode: 0o755 },
    { path: `/usr/share/applications/${app.appId}.desktop`, source: join(work, "app.desktop"), mode: 0o644 },
    { path: `/usr/share/icons/hicolor/${iconDir}/apps/${app.appId}${iconExt}`, source: iconSrc, mode: 0o644 },
  ];
  const tree = join(work, "root");
  for (const f of files) {
    const dest = join(tree, f.path);
    mkdirSync(join(dest, ".."), { recursive: true });
    copyFileSync(f.source, dest);
    chmodSync(dest, f.mode);
  }
  if ((await $`command -v desktop-file-validate`.nothrow().quiet()).exitCode === 0) {
    await $`desktop-file-validate ${join(tree, files[1]!.path)}`;
  }

  // ---- 4. artifacts ----------------------------------------------------------------

  const results: string[] = [];
  const ctx = { app, files, tree, work, out };
  for (const t of targets) {
    console.log(`• ${t}`);
    if (t === "deb") results.push(await buildDeb(ctx));
    else if (t === "rpm") results.push(await buildRpm(ctx));
    else if (t === "appimage") results.push(await buildAppImage(ctx));
    else {
      const file = join(out, `${name}-${app.version}-linux-${app.arch.rpm}.tar.gz`);
      const dir = `${name}-${app.version}`;
      await $`tar -C ${tree} --transform ${`s,^\\.,${dir},`} --owner=0 --group=0 --numeric-owner --sort=name -czf ${file} .`;
      results.push(file);
    }
  }
  rmSync(join(out, ".work"), { recursive: true, force: true });

  console.log("\nPacotes:");
  for (const r of results) console.log(`  ${r}  (${(statSync(r).size / 2 ** 20).toFixed(1)} MB)`);
}
