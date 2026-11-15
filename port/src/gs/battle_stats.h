/* What a finished online match tells the ranking (gs/net_lobby.c, match_post): read from the fight by
   Port_BattleStats (headless.c). Read only; nothing here is part of the game's state. */
#ifndef PORT_BATTLE_STATS_H
#define PORT_BATTLE_STATS_H
#ifdef __cplusplus
extern "C" {
#endif

enum { BSTAT_TEAM = 5 };

typedef struct {
    int state;                  /* the battle sequence's state (-1 outside a battle; 3 the fight is on) */
    int count[2];               /* fighters on each side (1 to 5) */
    int chara[2][BSTAT_TEAM];   /* their character ids */
    int cost[2];                /* the side's cost: the characters' points summed (the menu's DP) */
    int hpPct[2];               /* the side's health left, of all its fighters together, 0 to 100 */
    int combo[2], hits[2];      /* the combo the side is dealing now: its damage and its hits (0 none) */
} PortBattleStats;

int Port_BattleStats(PortBattleStats *out); /* 1: in a battle and `out` is filled */

#ifdef __cplusplus
}
#endif
#endif
