/* The controller drawn on the screen for phones (touch_pad.c): a stick under the left thumb, the pad's buttons under
   the right, shown from the first touch on. */
#ifndef TOUCH_PAD_H
#define TOUCH_PAD_H
#include <SDL3/SDL.h>
#ifdef __cplusplus
extern "C" {
#endif
enum { TOUCH_MENU = 0x10000 }; /* (beside the pad's 16 button bits: the settings window's button) */
typedef struct { float x, y, r; const char *label; unsigned bit; int held; } TouchPadButton; /* x, y, r: in window heights; x < 0: from the right edge */

int PortTouch_Event(const SDL_Event *ev); /* 1: a touch on the settings window's button (the caller opens it) */
int PortTouch_Visible(void);
unsigned PortTouch_Read(unsigned char *lx, unsigned char *ly); /* held buttons; the stick's bytes when it is held */
int PortTouch_Buttons(const TouchPadButton **out);             /* for drawing: the buttons */
int PortTouch_Stick(float *ox, float *oy, float *x, float *y);  /* for drawing: 1 while held; origin and thumb, 0..1 of the window */
#ifdef __cplusplus
}
#endif
#endif
