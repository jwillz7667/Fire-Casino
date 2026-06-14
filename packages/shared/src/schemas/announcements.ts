import { z } from "zod";
import { announcementAudienceSchema } from "../enums";

/**
 * Announcements (docs/06 §3.13). Broadcast to the caller's subtree (players
 * and/or operators); targeting by operatorScopePath restricts to a branch.
 */
export const createAnnouncementSchema = z.object({
  title: z.string().min(2).max(160),
  body: z.string().min(1).max(2000),
  audience: announcementAudienceSchema.default("PLAYERS"),
  operatorScopePath: z.string().max(200).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const listAnnouncementsQuerySchema = z.object({
  activeOnly: z.coerce.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
