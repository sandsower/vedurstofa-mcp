import { describe, expect, it } from "vitest";

import { filterActive, parseCapDocument } from "../src/sources/warnings.js";

const SAMPLE_CAP = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>vi-2026-04-13-001</identifier>
  <sender>imo@vedur.is</sender>
  <sent>2026-04-13T08:00:00+00:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en-US</language>
    <category>Met</category>
    <event>Severe wind</event>
    <urgency>Expected</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <effective>2026-04-13T09:00:00+00:00</effective>
    <expires>2099-04-13T21:00:00+00:00</expires>
    <senderName>Icelandic Met Office</senderName>
    <headline>Strong south-easterly winds</headline>
    <description>Winds of 20-28 m/s expected along the south coast.</description>
    <instruction>Secure loose objects. Avoid unnecessary travel.</instruction>
    <area>
      <areaDesc>Suðurland</areaDesc>
      <polygon>63.8,-20.0 63.8,-18.0 63.4,-18.0 63.4,-20.0 63.8,-20.0</polygon>
      <geocode>
        <valueName>EMMA_ID</valueName>
        <value>IS009</value>
      </geocode>
    </area>
  </info>
</alert>`;

describe("parseCapDocument", () => {
  it("parses a single CAP alert end-to-end", () => {
    const alerts = parseCapDocument(SAMPLE_CAP);
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert.identifier).toBe("vi-2026-04-13-001");
    expect(alert.sender).toBe("imo@vedur.is");
    expect(alert.status).toBe("Actual");
    expect(alert.scope).toBe("Public");
    expect(alert.infos).toHaveLength(1);
    const info = alert.infos[0]!;
    expect(info.event).toBe("Severe wind");
    expect(info.severity).toBe("Severe");
    expect(info.headline).toBe("Strong south-easterly winds");
    expect(info.areas).toHaveLength(1);
    expect(info.areas[0]?.description).toBe("Suðurland");
    expect(info.areas[0]?.geocodes[0]?.value).toBe("IS009");
  });

  it("returns empty array when no alerts present", () => {
    expect(parseCapDocument("<root><nothing/></root>")).toEqual([]);
  });
});

describe("filterActive", () => {
  it("keeps alerts whose expiry is in the future", () => {
    const alerts = parseCapDocument(SAMPLE_CAP);
    const active = filterActive(alerts, new Date("2026-04-13T12:00:00Z"));
    expect(active).toHaveLength(1);
  });

  it("drops alerts whose all info blocks have expired", () => {
    const alerts = parseCapDocument(SAMPLE_CAP);
    const future = new Date("2099-12-31T00:00:00Z");
    expect(filterActive(alerts, future)).toHaveLength(0);
  });

  it("keeps alerts with no expiry set", () => {
    const alerts = parseCapDocument(SAMPLE_CAP);
    // Remove expires from the info block.
    alerts[0]!.infos[0]!.expires = null;
    expect(filterActive(alerts, new Date("2099-12-31T00:00:00Z"))).toHaveLength(1);
  });
});
