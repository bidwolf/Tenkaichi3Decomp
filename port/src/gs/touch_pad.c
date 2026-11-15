/* The controller drawn on the screen, for phones: see touch_pad.h.

   Fingers are followed from SDL's finger events (positions 0..1 of the window). A finger that comes down on a button
   holds it until it lifts (sliding off it lets go, sliding onto another presses that one: a thumb can roll from one
   button to the next). A finger that comes down anywhere else on the left 45% of the screen plants the stick there;
   how far it then moves from that point is the stick, full at a seventh of the window's height. The buttons' places
   are in window heights from the left edge, or from the right edge when x is negative, so they keep their size and
   corner on any screen shape. Nothing is shown, and nothing pressed, until the screen is touched once; the settings
   window takes the touches while it is open (as it takes the mouse). */
#include "touch_pad.h"
#include <math.h>
#include <string.h>

extern int gPortOverlayOpen; /* gs_input.c */

enum { B_SELECT = 0x0001, B_START = 0x0008, B_UP = 0x0010, B_RIGHT = 0x0020, B_DOWN = 0x0040, B_LEFT = 0x0080, B_L2 = 0x0100, B_R2 = 0x0200,
       B_L1 = 0x0400, B_R1 = 0x0800, B_TRIANGLE = 0x1000, B_CIRCLE = 0x2000, B_CROSS = 0x4000, B_SQUARE = 0x8000 };

static TouchPadButton sButtons[] = {
    {-0.23f, 0.80f, 0.085f, "X", B_CROSS, 0},     {-0.11f, 0.64f, 0.085f, "O", B_CIRCLE, 0},
    {-0.35f, 0.64f, 0.085f, "[]", B_SQUARE, 0},   {-0.23f, 0.48f, 0.085f, "/\\", B_TRIANGLE, 0},
    {-0.10f, 0.12f, 0.075f, "R1", B_R1, 0},       {-0.28f, 0.12f, 0.075f, "R2", B_R2, 0},
    {0.10f, 0.12f, 0.075f, "L1", B_L1, 0},        {0.28f, 0.12f, 0.075f, "L2", B_L2, 0},
    {0.62f, 0.07f, 0.055f, "SELECT", B_SELECT, 0}, {-0.62f, 0.07f, 0.055f, "START", B_START, 0},
    {0.20f, 0.36f, 0.055f, "^", B_UP, 0},         {0.20f, 0.60f, 0.055f, "v", B_DOWN, 0},
    {0.08f, 0.48f, 0.055f, "<", B_LEFT, 0},       {0.32f, 0.48f, 0.055f, ">", B_RIGHT, 0},
    {-0.46f, 0.07f, 0.055f, "F1", TOUCH_MENU, 0},
};
enum { BUTTONS = sizeof(sButtons) / sizeof(sButtons[0]), FINGERS = 10 };

static struct { SDL_FingerID id; int used, button, stick; float x, y; } sFinger[FINGERS];
static float sAspect = 16.0f / 9.0f; /* the window's width / height */
static float sStickX, sStickY;       /* where the stick was planted */
static int sSeen;

static int button_at(float x, float y) {
    int i, best = -1;
    float bestD = 1e9f;
    for (i = 0; i < BUTTONS; i++) {
        float bx = sButtons[i].x >= 0 ? sButtons[i].x : sAspect + sButtons[i].x;
        float dx = x * sAspect - bx, dy = y - sButtons[i].y, d = dx * dx + dy * dy, r = sButtons[i].r * 1.25f; /* (a little past the drawn edge) */
        if (d <= r * r && d < bestD) {
            best = i;
            bestD = d;
        }
    }
    return best;
}

int PortTouch_Event(const SDL_Event *ev) {
    int i, slot = -1, menu = 0;
    if (ev->type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED || ev->type == SDL_EVENT_WINDOW_RESIZED) {
        if (ev->window.data2 > 0) {
            sAspect = (float)ev->window.data1 / (float)ev->window.data2;
        }
        return 0;
    }
    if (ev->type != SDL_EVENT_FINGER_DOWN && ev->type != SDL_EVENT_FINGER_MOTION && ev->type != SDL_EVENT_FINGER_UP && ev->type != SDL_EVENT_FINGER_CANCELED) {
        return 0;
    }
    if (!sSeen) {
        SDL_Window *w = SDL_GetWindowFromID(ev->tfinger.windowID);
        int ww = 0, wh = 0;
        if (w != NULL && SDL_GetWindowSize(w, &ww, &wh) && wh > 0) {
            sAspect = (float)ww / (float)wh;
        }
        sSeen = 1;
    }
    for (i = 0; i < FINGERS; i++) {
        if (sFinger[i].used && sFinger[i].id == ev->tfinger.fingerID) {
            slot = i;
        }
    }
    if (ev->type == SDL_EVENT_FINGER_UP || ev->type == SDL_EVENT_FINGER_CANCELED) {
        if (slot >= 0) {
            sFinger[slot].used = 0;
        }
        return 0;
    }
    if (gPortOverlayOpen) { /* the settings window's (it reads touches as the mouse) */
        return 0;
    }
    if (slot < 0 && ev->type == SDL_EVENT_FINGER_DOWN) {
        for (i = 0; i < FINGERS && sFinger[i].used; i++) {
        }
        if (i == FINGERS) {
            return 0;
        }
        slot = i;
        memset(&sFinger[slot], 0, sizeof(sFinger[slot]));
        sFinger[slot].used = 1;
        sFinger[slot].id = ev->tfinger.fingerID;
        sFinger[slot].button = button_at(ev->tfinger.x, ev->tfinger.y);
        if (sFinger[slot].button < 0 && ev->tfinger.x < 0.45f) {
            int other = 0;
            for (i = 0; i < FINGERS; i++) {
                other = other || (i != slot && sFinger[i].used && sFinger[i].stick);
            }
            if (!other) {
                sFinger[slot].stick = 1;
                sStickX = ev->tfinger.x;
                sStickY = ev->tfinger.y;
            }
        }
        menu = sFinger[slot].button >= 0 && sButtons[sFinger[slot].button].bit == TOUCH_MENU;
    }
    if (slot < 0) {
        return 0;
    }
    sFinger[slot].x = ev->tfinger.x;
    sFinger[slot].y = ev->tfinger.y;
    if (!sFinger[slot].stick && ev->type == SDL_EVENT_FINGER_MOTION) {
        sFinger[slot].button = button_at(ev->tfinger.x, ev->tfinger.y);
    }
    return menu;
}

int PortTouch_Visible(void) { return sSeen; }

unsigned PortTouch_Read(unsigned char *lx, unsigned char *ly) {
    unsigned btn = 0;
    int i;
    for (i = 0; i < BUTTONS; i++) {
        sButtons[i].held = 0;
    }
    if (gPortOverlayOpen) {
        return 0;
    }
    for (i = 0; i < FINGERS; i++) {
        if (!sFinger[i].used) {
            continue;
        }
        if (sFinger[i].stick) {
            float dx = (sFinger[i].x - sStickX) * sAspect / 0.14f, dy = (sFinger[i].y - sStickY) / 0.14f, len = sqrtf(dx * dx + dy * dy);
            if (len > 1.0f) {
                dx /= len;
                dy /= len;
            }
            *lx = (unsigned char)(127.5f + dx * 127.5f);
            *ly = (unsigned char)(127.5f + dy * 127.5f);
        } else if (sFinger[i].button >= 0) {
            sButtons[sFinger[i].button].held = 1;
            if (sButtons[sFinger[i].button].bit != TOUCH_MENU) {
                btn |= sButtons[sFinger[i].button].bit;
            }
        }
    }
    return btn;
}

int PortTouch_Buttons(const TouchPadButton **out) {
    *out = sButtons;
    return BUTTONS;
}

int PortTouch_Stick(float *ox, float *oy, float *x, float *y) {
    int i;
    for (i = 0; i < FINGERS; i++) {
        if (sFinger[i].used && sFinger[i].stick) {
            *ox = sStickX;
            *oy = sStickY;
            *x = sFinger[i].x;
            *y = sFinger[i].y;
            return 1;
        }
    }
    return 0;
}
