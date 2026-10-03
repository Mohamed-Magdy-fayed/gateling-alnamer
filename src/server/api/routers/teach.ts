import { z } from "zod";
import {
  createDraftCourse,
  getTeacherCourse,
  listTeacherCourses,
  submitForReview,
} from "@/server/catalog/authoring";
import { draftCourseInput } from "@/server/catalog/authoring-input";
import { AppError } from "@/server/errors";
import { router, staffProcedure } from "../trpc";

// Teachers are staff: two-factor sign-in applies once A7b enforces it.
const teacherProcedure = staffProcedure("teacher");
const courseInput = z.object({ courseId: z.uuid({ error: "errors.invalidInput" }) });

export const teachRouter = router({
  /** A new draft course with its first lesson (approved teachers only). */
  create: teacherProcedure
    .input(draftCourseInput)
    .mutation(async ({ ctx, input }) => createDraftCourse(ctx.user.id, input)),

  /** The teacher's own courses. */
  mine: teacherProcedure.query(async ({ ctx }) => listTeacherCourses(ctx.user.id)),

  /** One of the teacher's own courses; anyone else's is not found. */
  get: teacherProcedure.input(courseInput).query(async ({ ctx, input }) => {
    const course = await getTeacherCourse(ctx.user.id, input.courseId);
    if (!course) throw new AppError("not_found");
    return course;
  }),

  /** Sends the teacher's own draft for review. */
  submit: teacherProcedure
    .input(courseInput)
    .mutation(async ({ ctx, input }) => submitForReview(ctx.user.id, input.courseId)),
});
