import { describe, it, expect } from "bun:test";
import { monthsBetween, daysBetween } from "./dates";

describe("monthsBetween", () => {
  it("2023-08-11 -> 2026-02-20 is 30 whole months", () => {
    expect(monthsBetween(new Date("2023-08-11"), new Date("2026-02-20"))).toBe(30);
  });

  it("subtracts one when the day of month has not been reached", () => {
    expect(monthsBetween(new Date("2023-08-11"), new Date("2026-02-10"))).toBe(29);
  });

  it("counts the month on the day of month itself", () => {
    expect(monthsBetween(new Date("2023-08-11"), new Date("2026-02-11"))).toBe(30);
  });

  it("handles same month, whole years and zero", () => {
    expect(monthsBetween(new Date("2026-02-01"), new Date("2026-02-28"))).toBe(0);
    expect(monthsBetween(new Date("2025-02-20"), new Date("2026-02-20"))).toBe(12);
    expect(monthsBetween(new Date("2026-02-20"), new Date("2026-02-20"))).toBe(0);
  });

  it("goes negative when to precedes from", () => {
    expect(monthsBetween(new Date("2026-02-20"), new Date("2023-08-11"))).toBe(-31);
  });

  it("is stable across a year boundary", () => {
    expect(monthsBetween(new Date("2025-12-31"), new Date("2026-01-01"))).toBe(0);
    expect(monthsBetween(new Date("2025-12-01"), new Date("2026-01-01"))).toBe(1);
  });

  it("reads UTC components, so a timestamp late in the UTC day is unambiguous", () => {
    expect(
      monthsBetween(
        new Date("2023-08-11T23:30:00.000Z"),
        new Date("2026-02-20T00:30:00.000Z"),
      ),
    ).toBe(30);
  });
});

describe("daysBetween", () => {
  it("2026-01-10 -> 2026-02-20 is 41 days", () => {
    expect(daysBetween(new Date("2026-01-10"), new Date("2026-02-20"))).toBe(41);
  });

  it("counts zero for the same day and one for the next", () => {
    expect(daysBetween(new Date("2026-02-20"), new Date("2026-02-20"))).toBe(0);
    expect(daysBetween(new Date("2026-02-20"), new Date("2026-02-21"))).toBe(1);
  });

  it("crosses a leap day", () => {
    expect(daysBetween(new Date("2024-02-28"), new Date("2024-03-01"))).toBe(2);
  });

  it("goes negative when to precedes from", () => {
    expect(daysBetween(new Date("2026-02-20"), new Date("2026-01-10"))).toBe(-41);
  });

  it("ignores the time of day, counting whole UTC calendar days", () => {
    expect(
      daysBetween(
        new Date("2026-01-10T09:00:00.000Z"),
        new Date("2026-02-20T08:00:00.000Z"),
      ),
    ).toBe(41);
  });
});
