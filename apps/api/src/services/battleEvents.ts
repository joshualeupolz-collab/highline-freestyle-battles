/**
 * Entries the app writes into a battle's chat, so the conversation also documents what happened
 * (owner's wish): proposals and the answers to them, extra attempts, choosing videos, votes.
 * Votes are logged without their value (they stay hidden until both voted).
 */
import type { Database } from '../db/client';
import { battleMessages } from '../db/schema';
import { newId } from '../lib/ids';

export type BattleEvent =
  | { type: 'accepted' }
  | { type: 'started' }
  | { type: 'proposal'; kind: string; payload: Record<string, unknown> }
  | { type: 'proposal_accepted' | 'proposal_rejected' | 'proposal_withdrawn'; kind: string }
  | { type: 'attempt_granted' }
  | { type: 'submitted' }
  | { type: 'unlocked' }
  | { type: 'voted' }
  | { type: 'deadline_decision'; choice: string }
  | { type: 'onsite_withdrawn' }
  | { type: 'group_result' | 'group_confirmed' | 'group_rejected' }
  | { type: 'official_confirmed'; name: string };

/** Statement for one chat entry; put it into the same batch as the change it documents. */
export function eventStatement(
  db: Database,
  battleId: string,
  actorId: string,
  event: BattleEvent,
  now: number,
) {
  return db.insert(battleMessages).values({
    id: newId(now),
    battleId,
    senderId: actorId,
    body: '',
    eventJson: JSON.stringify(event),
    createdAt: now,
  });
}
