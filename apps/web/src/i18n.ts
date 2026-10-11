/**
 * All user-facing texts. English for now; another language = another object with the same keys.
 * Use `t('key')` or `t('key', { name: 'Anna' })` for `{name}` placeholders.
 */
const en = {
  appName: 'Highline Battles',
  'nav.battles': 'My battles',
  'nav.open': 'Open requests',
  'nav.new': 'New battle',
  'nav.approvals': 'Approvals',
  'nav.admin': 'Admin',
  'nav.profile': 'Profile',

  'login.title': 'Log in',
  'login.submit': 'Log in',
  'login.noAccount': 'No account yet?',
  'login.register': 'Sign up',
  'login.forgot': 'Got a reset code?',
  'register.title': 'Sign up',
  'register.submit': 'Create account',
  'register.age': 'I am at least 16 years old.',
  'register.ageHint': 'Younger? Please contact the federation.',
  'register.questionnaire': 'A few words about you (helps people approve you)',
  'register.freestyleSince': 'Doing freestyle since',
  'register.community': 'Community / crew / location',
  'register.note': 'Anything else',
  'register.setupToken': 'Setup token (only for the very first admin)',
  'register.haveAccount': 'Already have an account?',
  'reset.title': 'Set a new password',
  'reset.hint': 'Ask an admin or the federation for a reset code. It is valid for 24 hours.',
  'reset.code': 'Reset code',
  'reset.submit': 'Set password',
  'reset.done': 'Done. You can log in with your new password now.',

  'field.username': 'Username',
  'field.displayName': 'Display name',
  'field.password': 'Password',
  'field.passwordHint': 'At least 10 characters.',
  'field.email': 'E-mail (optional)',
  'field.currentPassword': 'Current password',
  'field.newPassword': 'New password',

  'pending.title': 'Waiting for approval',
  'pending.text':
    'Your account has to be approved by someone from the community before you can battle. Tell an athlete you know your username: {username}',

  'battles.title': 'My battles',
  'battles.empty': 'No battles yet. Post a request or accept one!',
  'battles.actionNeeded': 'Needs your attention',
  'battles.running': 'Running',
  'battles.finished': 'Finished',
  'battles.vs': 'vs.',
  'battles.waitingForOpponent': 'waiting for an opponent',
  'open.title': 'Open requests',
  'open.empty': 'No open requests right now.',
  'open.accept': 'Accept',
  'open.direct': 'Challenge to you',
  'open.unrated': 'unrated',
  'new.title': 'New battle',
  'new.format': 'Format',
  'new.opponent': 'Challenge someone directly (optional)',
  'new.opponentHint': 'Leave empty to post an open request for everyone.',
  'new.submit': 'Post request',

  'settings.attempts': 'Attempts per video',
  'settings.unlimited': 'unlimited',
  'settings.timeWindow': 'Time window',
  'settings.days': '{n} days',
  'settings.flexibleTime': 'no deadline',
  'settings.level': 'Weight',
  'settings.level1': '1 – fun',
  'settings.level2': '2',
  'settings.level3': '3 – normal',
  'settings.scoring': 'Result',
  'settings.scale': '5-point scale (with margin)',
  'settings.win_loss': 'Win / loss only',
  'settings.flexible': 'Settings are a suggestion – agree on them with the opponent',

  'status.open': 'Open',
  'status.negotiating': 'Agreeing on settings',
  'status.active': 'Running',
  'status.reviewing': 'In review',
  'status.decided': 'Decided',
  'status.cancelled': 'Cancelled',
  'status.annulled': 'Annulled',

  'battle.deadline': 'Deadline',
  'battle.deadlinePassed': 'The deadline has passed.',
  'battle.recordingLater': 'Recording and uploading videos comes in the next version of the app.',
  'battle.accept': 'Accept battle',
  'battle.retract': 'Take back request',
  'battle.start': 'Start with these settings',
  'battle.proposeSettings': 'Propose other settings',
  'battle.proposeExtension': 'Ask for more time',
  'battle.extensionDays': 'More days',
  'battle.giveUp': 'Give up',
  'battle.giveUpConfirm':
    'Give up this battle? Your opponent decides whether it counts as their win.',
  'battle.grantAttempt': 'Give opponent an extra attempt',
  'battle.extraAttempts': '+{n} extra attempt(s)',
  'battle.claimWin': 'Count as my win',
  'battle.cancelUnrated': 'Cancel without rating',
  'battle.proposals': 'Proposals',
  'battle.proposal.settings': 'Change settings: {changes}',
  'battle.proposal.extension': 'New deadline: {date}',
  'battle.proposal.cancel':
    'Gives up. Accept = cancel without rating, Reject = counts as your win.',
  'battle.proposedBy': 'by {name}',
  'battle.acceptProposal': 'Accept',
  'battle.rejectProposal': 'Reject',
  'battle.withdrawProposal': 'Withdraw',
  'battle.send': 'Send proposal',
  'battle.result': 'Result',
  'battle.won': '{name} won',
  'battle.reason.forfeit': 'by forfeit',
  'battle.reason.deadline': 'missed deadline',
  'battle.reason.review': 'by review',

  'approvals.title': 'Approve new accounts',
  'approvals.empty': 'Nobody is waiting for approval.',
  'approvals.approve': 'Approve',
  'approvals.hint':
    'Only approve people you know are real highliners. Your name is stored as their inviter.',

  'admin.title': 'Admin',
  'admin.resetCode': 'Password reset code',
  'admin.resetCodeHint':
    'Create a one-time code for someone who forgot their password and hand it over personally.',
  'admin.createCode': 'Create code',
  'admin.codeFor': 'Code for {name}, valid until {date}:',
  'admin.formats': 'Formats',
  'admin.newFormat': 'New format',
  'admin.slug': 'Short id (e.g. trick-combo-5)',
  'admin.name': 'Name',
  'admin.partKind': 'Part',
  'admin.count': 'Number of tricks / bounces',
  'admin.create': 'Create format',

  'profile.title': 'Profile',
  'profile.roles': 'Roles',
  'profile.changePassword': 'Change password',
  'profile.passwordChanged': 'Password changed. Other devices were logged out.',
  'profile.logout': 'Log out',

  'part.best_trick': 'Best trick',
  'part.trick_combo': 'Trick combo',
  'part.bounce_combo': 'Bounce combo',
  'part.response': 'Response',

  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.searchUser': 'Search username…',
  'common.clear': 'clear',

  'error.unknown_error': 'Something went wrong. Please try again.',
  'error.invalid_credentials': 'Username or password is wrong.',
  'error.too_many_attempts': 'Too many failed logins. Please wait 15 minutes.',
  'error.account_disabled': 'This account is disabled.',
  'error.username_taken': 'This username is already taken.',
  'error.email_taken': 'This e-mail address is already used.',
  'error.invalid_setup_token': 'The setup token is not valid.',
  'error.validation_failed': 'Please check your input.',
  'error.wrong_password': 'The current password is wrong.',
  'error.invalid_code': 'This code is not valid or was already used.',
  'error.not_open': 'This request is no longer open.',
  'error.forbidden': 'You are not allowed to do this.',
  'error.level_requires_approval': 'Weight 4–5 needs approval by a judge (coming later).',
  'error.deadline_must_be_later': 'The new deadline must be later than the current one.',
  'error.use_extension': 'The battle is running: ask for more time instead.',
  'error.slug_taken': 'This short id is already used.',
} as const;

export type MessageKey = keyof typeof en;

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Translated text for an API error code (falls back to a generic message). */
export function errorText(code: string): string {
  const key = `error.${code}` as MessageKey;
  return key in en ? t(key) : t('error.unknown_error');
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
