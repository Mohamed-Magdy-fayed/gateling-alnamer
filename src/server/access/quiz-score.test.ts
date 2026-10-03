import { describe, expect, it } from "vitest";
import { cleanAnswers, scoreAnswers } from "./quiz-score";

const KEY = [
  { id: "q1", correct: "b", optionIds: ["a", "b", "c"] },
  { id: "q2", correct: "true", optionIds: ["true", "false"] },
  { id: "q3", correct: "c", optionIds: ["a", "b", "c"] },
];

describe("cleanAnswers", () => {
  it("keeps only known questions with one of their own option ids", () => {
    expect(cleanAnswers(KEY, { q1: "b", q2: "maybe", q9: "a", q3: "c", __proto__: "x" })).toEqual({
      q1: "b",
      q3: "c",
    });
  });

  it("accepts nothing that is not a plain string map", () => {
    expect(cleanAnswers(KEY, null)).toEqual({});
    expect(cleanAnswers(KEY, ["b"])).toEqual({});
    expect(cleanAnswers(KEY, { q1: 2 })).toEqual({});
  });
});

describe("scoreAnswers", () => {
  it("rounds to a whole percent of all questions", () => {
    expect(scoreAnswers(KEY, { q1: "b", q2: "true" })).toEqual({ correct: 2, total: 3, pct: 67 });
    expect(scoreAnswers(KEY, { q1: "b", q2: "true", q3: "c" }).pct).toBe(100);
  });

  it("scores unanswered and wrong answers as zero", () => {
    expect(scoreAnswers(KEY, {})).toEqual({ correct: 0, total: 3, pct: 0 });
    expect(scoreAnswers(KEY, { q1: "a", q2: "false" }).pct).toBe(0);
  });

  it("is 0 for an empty quiz", () => {
    expect(scoreAnswers([], {})).toEqual({ correct: 0, total: 0, pct: 0 });
  });
});
