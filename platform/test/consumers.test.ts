// Tests of registerConsumers (platform/src/jobs/consumers.ts): handlers get onto the bus only through the manifests' events.consumes.
// Where it fits: pure tests, no database. Run with: npm run test -w @sheetal/platform
// What they prove: a manifest entry with no code, code with no manifest entry, a wrong handler-id prefix and a repeated handler id are all
// refused at startup; nothing is half-registered after a refusal; a platform handler is marked as one; the returned function removes everything.
import { describe, expect, it, vi } from "vitest";
import { OutboxEventBus } from "../src/core/events.js";
import { registerConsumers, type ConsumerImpls } from "../src/jobs/consumers.js";

const manifest = (id: string, consumes: { name: string; handler: string }[]) =>
  ({ id, events: { publishes: [], consumes: consumes.map((c) => ({ ...c, why: "test" })) } }) as never;
const impl = (): ConsumerImpls[string] => ({ run: vi.fn(async () => {}) as never });

describe("registerConsumers", () => {
  it("subscribes each declared handler with its pattern and app", () => {
    const bus = new OutboxEventBus();
    registerConsumers(bus, [manifest("invoicing", [{ name: "expenses.expense.confirmed", handler: "invoicing.on-expense-confirmed" }])], { "invoicing.on-expense-confirmed": impl() });
    const subs = bus.handlersFor("expenses.expense.confirmed");
    expect(subs).toHaveLength(1);
    expect(subs[0]!.opts).toMatchObject({ id: "invoicing.on-expense-confirmed", app: "invoicing" });
    expect(subs[0]!.opts.platform).toBeUndefined();
  });

  it("marks a platform handler", () => {
    const bus = new OutboxEventBus();
    registerConsumers(bus, [manifest("billing", [{ name: "billing.cycle.ran", handler: "billing.on-cycle" }])], { "billing.on-cycle": { run: vi.fn(async () => {}) as never, platform: true } });
    expect(bus.handlersFor("billing.cycle.ran")[0]!.opts).toMatchObject({ platform: true });
  });

  it("refuses a manifest entry that has no code", () => {
    const bus = new OutboxEventBus();
    expect(() => registerConsumers(bus, [manifest("invoicing", [{ name: "a.b.c", handler: "invoicing.missing" }])], {})).toThrow(/no code is registered for that handler/);
  });

  it("refuses code that no manifest lists", () => {
    const bus = new OutboxEventBus();
    expect(() => registerConsumers(bus, [manifest("invoicing", [])], { "invoicing.sneaky": impl() })).toThrow(/no manifest lists it/);
    expect(bus.handlersFor("a.b.c")).toHaveLength(0);
  });

  it("refuses a handler id that does not start with the app id, and a handler id declared twice", () => {
    const bus = new OutboxEventBus();
    expect(() => registerConsumers(bus, [manifest("invoicing", [{ name: "a.b.c", handler: "reports.on-x" }])], { "reports.on-x": impl() })).toThrow(/must start with "invoicing\."/);
    expect(() => registerConsumers(bus, [manifest("invoicing", [{ name: "a.b.c", handler: "invoicing.on-x" }, { name: "a.b.d", handler: "invoicing.on-x" }])], { "invoicing.on-x": impl() })).toThrow(/declared twice/);
  });

  it("registers nothing when one entry fails, and its returned function removes all it registered", () => {
    const bus = new OutboxEventBus();
    const ms = [manifest("invoicing", [{ name: "a.b.c", handler: "invoicing.one" }, { name: "a.b.d", handler: "invoicing.two" }])];
    expect(() => registerConsumers(bus, ms, { "invoicing.one": impl() })).toThrow(/no code is registered/);
    expect(bus.handlersFor("a.b.c")).toHaveLength(0);
    const off = registerConsumers(bus, ms, { "invoicing.one": impl(), "invoicing.two": impl() });
    expect(bus.handlersFor("a.b.c")).toHaveLength(1);
    expect(bus.handlersFor("a.b.d")).toHaveLength(1);
    off();
    expect(bus.handlersFor("a.b.c")).toHaveLength(0);
    expect(bus.handlersFor("a.b.d")).toHaveLength(0);
  });

  it("does nothing, quietly, when no app consumes anything (today)", () => {
    const bus = new OutboxEventBus();
    expect(() => registerConsumers(bus, [manifest("expenses", []), manifest("reviews", [])], {})).not.toThrow();
  });
});
