// Linux event pump. A helper thread only poll()s the Wayland socket and the
// key-repeat timerfd, then wakes the JS thread; all reading and dispatching
// happens in nb_platform_pump_process() on the JS thread. The helper waits
// until that is done before polling again. No libuv, so it runs on Bun and Node.
#define _GNU_SOURCE
#include <poll.h>
#include <pthread.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <sys/eventfd.h>
#include <unistd.h>

#include "linux.h"

enum { READY_DISPLAY = 1, READY_REPEAT = 2 };

static nb_wake_fn wake;
static pthread_t thread;
static sem_t resume;
static int quit_fd = -1;
static atomic_bool quit;
static atomic_int ready;
static bool running;

static void *pump(void *arg) {
  while (!atomic_load(&quit)) {
    struct pollfd fds[3] = {
        {.fd = nb_wl_fd(), .events = POLLIN},
        {.fd = nb_wl_repeat_fd(), .events = POLLIN},
        {.fd = quit_fd, .events = POLLIN},
    };
    if (poll(fds, 3, -1) < 0) continue;
    if (atomic_load(&quit)) break;
    int r = 0;
    if (fds[0].revents) r |= READY_DISPLAY;
    if (fds[1].revents & POLLIN) r |= READY_REPEAT;
    if (!r) continue;
    atomic_fetch_or(&ready, r);
    wake();
    sem_wait(&resume);
  }
  return NULL;
}

bool nb_platform_pump_start(nb_wake_fn fn) {
  if (running) return true;
  wake = fn;
  sem_init(&resume, 0, 0);
  quit_fd = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
  atomic_store(&quit, false);
  atomic_store(&ready, 0);
  if (quit_fd < 0 || pthread_create(&thread, NULL, pump, NULL) != 0) return false;
  running = true;
  return true;
}

void nb_platform_pump_stop(void) {
  if (!running) return;
  running = false;
  atomic_store(&quit, true);
  uint64_t one = 1;
  if (write(quit_fd, &one, sizeof one) < 0) {}
  sem_post(&resume);
  pthread_join(thread, NULL);
  close(quit_fd);
  quit_fd = -1;
}

void nb_platform_pump_process(void) {
  if (!running) return;  // a wake-up queued before pump_stop
  int r = atomic_exchange(&ready, 0);
  if (r & READY_REPEAT) nb_wl_repeat_tick();
  if ((r & READY_DISPLAY) && nb_wl_dispatch() < 0) {
    nb_event e = {.type = NB_EV_CLOSE};
    nb_push_event(&e);
  }
  nb_platform_flush();
  sem_post(&resume);
}
