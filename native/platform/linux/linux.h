// Internal API shared by the Linux backend files (window.c <-> pump.c).
#pragma once

#include "nb.h"

int nb_wl_fd(void);           // Wayland display socket
int nb_wl_dispatch(void);     // non-blocking read + dispatch; -1 on error
int nb_wl_repeat_fd(void);    // timerfd that fires for key repeat
void nb_wl_repeat_tick(void);
