/**
 * Golden test — every environment definition the pinned submodule ships must
 * read, and its internal references must resolve.
 */

import { describe, expect, it } from "vitest";

import { deviceOf, spotNameOf } from "../../src/model/common";
import { readEnvironmentText } from "../../src/read";
import { environmentFiles, read } from "./corpus";

it("the pinned submodule ships environment definitions", () => {
  expect(environmentFiles.length).toBeGreaterThanOrEqual(5);
});

for (const [dir, name] of environmentFiles)
  describe(name, () => {
    const env = readEnvironmentText(read(dir, name));

    const spots = new Set(
      env.devices.flatMap((d) => d.spots.map((s) => `${d.id}.${s}`)),
    );
    const deviceIds = new Set(env.devices.map((d) => d.id));
    const transporterIds = new Set(env.transporters.map((t) => t.id));

    it("declares at least one device (§5.2)", () => {
      expect(env.devices.length).toBeGreaterThan(0);
    });

    it("device and transporter ids are unique across both (§8.2)", () => {
      const all = [...env.devices.map((d) => d.id), ...env.transporters.map((t) => t.id)];
      expect(new Set(all).size).toBe(all.length);
    });

    it("the transport table names declared transporters and declared spots (§5.4)", () => {
      for (const t of env.transports) {
        expect(transporterIds, `transporter ${t.transporter}`).toContain(t.transporter);
        expect(spots, `from ${t.from}`).toContain(t.from);
        expect(spots, `to ${t.to}`).toContain(t.to);
        expect(t.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("mode ids are unique within a process, and assigned when omitted (§5.5)", () => {
      for (const [pname, p] of Object.entries(env.processes)) {
        const ids = p.modes.map((m) => m.id);
        expect(new Set(ids).size, `${pname}: ${ids.join(",")}`).toBe(ids.length);
        for (const id of ids) expect(id).not.toBe("");
      }
    });

    it("a mode's spots are qualified and sit on its own devices (§5.5)", () => {
      for (const [pname, p] of Object.entries(env.processes))
        for (const m of p.modes) {
          const owned = new Set(m.devices);
          for (const d of m.devices) expect(deviceIds, `${pname} mode ${m.id}`).toContain(d);
          for (const spot of [
            ...Object.values(m.inputSpots),
            ...Object.values(m.outputSpots),
          ]) {
            expect(spotNameOf(spot), `${pname} mode ${m.id}: "${spot}" is not qualified`).not.toBe("");
            expect(owned, `${pname} mode ${m.id}: ${spot}`).toContain(deviceOf(spot));
            expect(spots, `${pname} mode ${m.id}: ${spot}`).toContain(spot);
          }
        }
    });

    it("consumption names a resource declared on one of the mode's devices (§5.5)", () => {
      const capacity = new Map<string, number>();
      for (const d of env.devices)
        for (const [r, def] of Object.entries(d.resources ?? {}))
          capacity.set(`${d.id}.${r}`, def.capacity);

      for (const [pname, p] of Object.entries(env.processes))
        for (const m of p.modes)
          for (const [ref, amount] of Object.entries(m.consumption ?? {})) {
            expect(capacity.has(ref), `${pname} mode ${m.id}: ${ref} undeclared`).toBe(true);
            expect(amount).toBeGreaterThan(0);
            expect(amount).toBeLessThanOrEqual(capacity.get(ref)!);
          }
    });
  });
