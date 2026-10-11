/**
 * Request schemas for accounts and login. Used by the API for validation and by the web app
 * for its forms, so both always agree on the rules.
 */
import { z } from 'zod';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 8;
/** Upper bound so nobody can make the server hash megabytes. */
export const PASSWORD_MAX = 128;

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Only letters, digits, "_", "." and "-" are allowed');

export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const displayNameSchema = z.string().trim().min(1).max(50);

/** Optional short questionnaire shown at sign-up (concept section 3). */
export const questionnaireSchema = z
  .object({
    /** e.g. "2019" or "3 years" – free text on purpose. */
    freestyleSince: z.string().trim().max(100).optional(),
    /** Community, crew or location. */
    community: z.string().trim().max(200).optional(),
    /** Anything else the approving person should know. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const registerRequestSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  email: z.email().max(254).optional(),
  /** "I am at least 16 years old." Must be ticked. */
  ageConfirmed: z.literal(true),
  questionnaire: questionnaireSchema.optional(),
  /** One-time setup secret that makes the very first account an admin. */
  setupToken: z.string().max(200).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(USERNAME_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: passwordSchema,
});

export const resetPasswordRequestSchema = z.object({
  /** Code handed over by an admin or the federation. */
  code: z.string().trim().min(1).max(200),
  newPassword: passwordSchema,
});

/**
 * Delete one's own account (concept section 12). Results and opponents' ratings stay; the profile
 * becomes "Deleted user". `keepVideos`: videos that count in battles stay (preselected).
 */
export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX),
  keepVideos: z.boolean().default(true),
});

/** Later request with the deletion link: delete the videos that were kept. */
export const deletionRequestSchema = z.object({ token: z.string().min(20).max(100) });
