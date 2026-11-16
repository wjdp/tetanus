import { z } from "zod";
import { DIARY_ENTRY_KINDS, DIARY_SUBJECT_TYPES } from "../diary";
import { pageQuerySchema } from "./page";

const subjectId = z.coerce.number().int().positive();

export const diaryQuerySchema = pageQuerySchema({
  subjectType: z.enum(DIARY_SUBJECT_TYPES).optional(),
  subjectId: subjectId.optional(),
  kind: z.enum(DIARY_ENTRY_KINDS).optional(),
});

export type DiaryQuery = z.infer<typeof diaryQuerySchema>;

const title = z.string().trim().min(1).max(200);
const body = z.string().max(100_000);
const at = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const diaryEntryInputSchema = z.strictObject({
  subjectType: z.enum(DIARY_SUBJECT_TYPES),
  subjectId: z.number().int().positive().nullable().optional(),
  title,
  body: body.optional(),
  at: at.optional(),
});

export type DiaryEntryInput = z.infer<typeof diaryEntryInputSchema>;

export const diaryParamsSchema = z.object({ id: subjectId });

export const diaryEntryPatchSchema = z.strictObject({
  title: title.optional(),
  body: body.optional(),
  at: at.optional(),
});

export type DiaryEntryPatch = z.infer<typeof diaryEntryPatchSchema>;
