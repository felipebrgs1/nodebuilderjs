// Linux event pump. A helper thread only poll()s the fds the active backend
// exposes (display socket, timerfds, clipboard pipes...) and wakes the JS thread;
// all reading and dispatching happens in nb_platform_pump_process() on the JS
// thread, which also hands over the fds to watch next. The helper waits until
// that is done before polling again. No libuv, so it runs on Bun and Node.
#define _GNU_SOURCE
#include <pthread.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <string.h>
#include <sys/eventfd.h>
#include <unistd.h>

#include "linux.h"

static nb_wake_fn wake;
static pthread_t thread;
static sem_t resume;
static int control_fd = -1;  // eventfd: wakes poll() to quit or to pick up new fds
static atomic_bool quit;
static bool running;

// Handed back and forth: the JS thread writes `watched` before letting the helper
// poll (sem_post); the helper writes `ready` before waking the JS thread.
static struct pollfd watched[NB_LINUX_MAX_FDS], ready[NB_LINUX_MAX_FDS];
static int watched_count, ready_count;

static void *pump(void *arg) {
  while (!atomic_load(&quit)) {
    struct pollfd fds[NB_LINUX_MAX_FDS + 1];
    int count = watched_count;
    memcpy(fds, watched, count * sizeof *fds);
    fds[count] = (struct pollfd){.fd = control_fd, .events = POLLIN};
    if (poll(fds, count + 1, -1) < 0) continue;
    if (atomic_load(&quit)) break;
    uint64_t n;
    bool refresh = fds[count].revents && read(control_fd, &n, sizeof n) > 0;
    ready_count = 0;
    for (int i = 0; i < count; i++)
      if (fds[i].revents) ready[ready_count++] = fds[i];
    if (!ready_count && !refresh) continue;
    wake();
    sem_wait(&resume);
  }
  return NULL;
}

bool nb_platform_pump_start(nb_wake_fn fn) {
  if (running) return true;
  const nb_linux_backend *backend = nb_linux_active();
  if (!backend) return false;
  wake = fn;
  sem_init(&resume, 0, 0);
  control_fd = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
  atomic_store(&quit, false);
  watched_count = backend->fds(watched, NB_LINUX_MAX_FDS);
  if (control_fd < 0 || pthread_create(&thread, NULL, pump, NULL) != 0) return false;
  running = true;
  return true;
}

static void signal_control(void) {
  uint64_t one = 1;
  if (write(control_fd, &one, sizeof one) < 0) {}
}

void nb_platform_pump_stop(void) {
  if (!running) return;
  running = false;
  atomic_store(&quit, true);
  signal_control();
  sem_post(&resume);
  pthread_join(thread, NULL);
  close(control_fd);
  control_fd = -1;
}

void nb_linux_pump_refresh(void) {
  if (running) signal_control();
}

void nb_platform_pump_process(void) {
  if (!running) return;  // a wake-up queued before pump_stop
  const nb_linux_backend *backend = nb_linux_active();
  if (backend->process(ready, ready_count) < 0) {
    nb_event e = {.type = NB_EV_CLOSE};
    nb_push_event(&e);
  }
  ready_count = 0;
  nb_platform_flush();
  watched_count = backend->fds(watched, NB_LINUX_MAX_FDS);
  sem_post(&resume);
}
