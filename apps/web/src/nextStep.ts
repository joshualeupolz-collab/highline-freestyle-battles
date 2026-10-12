/**
 * "What do I have to do next?" for a battle, in one place for the battle list and the battle
 * page. `urgent` = it waits for me (shown under "Needs your attention").
 */
import type { Battle, BattleSummary } from './api';
import type { MessageKey } from './i18n';

export interface Todo {
  submittedAll: boolean;
  iVoted: boolean;
  /** Level 1 votes so far (both voted without agreement = 2 while still in review). */
  votes: number;
  proposalForMe: boolean;
  /** 1 = the two athletes, 2 = pool, 3 = judge. */
  reviewLevel: number;
}

export interface NextStep {
  key: MessageKey;
  urgent: boolean;
}

type Basics = Pick<
  BattleSummary,
  'status' | 'mode' | 'createdBy' | 'invitedUserId' | 'deadlinePassed' | 'participants'
>;

export function nextStep(battle: Basics, todo: Todo, myId: string): NextStep | null {
  const mine = battle.participants.find((p) => p.userId === myId);
  const step = (key: MessageKey, urgent: boolean) => ({ key, urgent });
  switch (battle.status) {
    case 'open':
      if (battle.invitedUserId === myId) return step('next.challenged', true);
      return battle.createdBy === myId ? step('next.waitingForOpponent', false) : null;
    case 'negotiating':
      if (battle.mode === 'onsite')
        return todo.proposalForMe
          ? step('next.confirmResult', true)
          : step('next.waitingForConfirmation', false);
      if (todo.proposalForMe) return step('next.answerProposal', true);
      return mine?.seat === 1
        ? step('next.startOrPropose', true)
        : step('next.waitingAgree', false);
    case 'active':
      if (!mine) return null;
      if (battle.deadlinePassed) return step('next.deadlinePassed', true);
      if (todo.proposalForMe) return step('next.answerProposal', true);
      return todo.submittedAll ? step('next.waitingVideos', false) : step('next.record', true);
    case 'reviewing':
      if (!mine) return null;
      if (todo.reviewLevel === 2) return step('next.pool', false);
      if (todo.reviewLevel === 3) return step('next.judge', false);
      if (!todo.iVoted) return step('next.vote', true);
      return todo.votes >= 2 ? step('next.noAgreement', true) : step('next.waitingVote', false);
    default:
      return null;
  }
}

/** The same flags as the battle list gets from the server, worked out from a full battle. */
export function todoOf(battle: Battle, myId: string, partsCount: number): Todo {
  const chosen = battle.videos.slots.filter((s) => s.userId === myId && s.submittedAt !== null);
  return {
    submittedAll: chosen.length >= Math.max(partsCount, 1),
    iVoted: battle.review?.voted.includes(myId) ?? false,
    votes: battle.review?.voted.length ?? 0,
    proposalForMe: battle.proposals.some(
      (p) => p.proposedBy !== myId && !p.acceptedBy.includes(myId),
    ),
    reviewLevel: battle.review?.level ?? 1,
  };
}
