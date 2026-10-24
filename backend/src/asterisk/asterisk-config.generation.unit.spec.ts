import {
  AsteriskConfigService,
  parsePjsipIdentifies,
} from "./asterisk-config.service";
import { SipTrunkEntity } from "../trunks/entities/sip-trunk.entity";
import { buildRtpConfig, getEnvRtpRange, validateRtpRange } from "./rtp-range";
import { InboundRouteEntity } from "../inbound-routes/entities/inbound-route.entity";

// Documentation address ranges (RFC 5737), not real provider addresses.
const buildService = () =>
  new AsteriskConfigService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

const trunk = (overrides: Partial<SipTrunkEntity>): SipTrunkEntity =>
  ({
    id: 1,
    name: "Example",
    host: "sip.example.com",
    port: 5060,
    username: null,
    password: null,
    providerPreset: "generic",
    fromDomain: null,
    fromUser: null,
    inboundIps: [],
    enabled: true,
    ...overrides,
  }) as SipTrunkEntity;

describe("trunk config generation", () => {
  const service = buildService();
  const build = (trunks: SipTrunkEntity[]): string =>
    (service as any).buildTrunksConfig(trunks);

  it("generates an identify section with one match line per inbound IP", () => {
    const output = build([
      trunk({ inboundIps: ["192.0.2.10", "198.51.100.0/24"] }),
    ]);
    expect(output).toContain(
      [
        "[trunk-1-identify]",
        "type = identify",
        "endpoint = trunk-1",
        "match = 192.0.2.10",
        "match = 198.51.100.0/24",
      ].join("\n"),
    );
  });

  it("generates no identify section when the list is empty", () => {
    const output = build([trunk({ inboundIps: [] })]);
    expect(output).not.toContain("type = identify");
  });

  it("generates no identify section when inboundIps is missing (pre-migration row)", () => {
    const output = build([trunk({ inboundIps: undefined })]);
    expect(output).not.toContain("type = identify");
  });

  it("generates auth and outbound_auth only when credentials are filled in", () => {
    const withAuth = build([
      trunk({ username: "user", password: "secret"}),
    ]);
    expect(withAuth).toContain("type = auth");
    expect(withAuth).toContain("outbound_auth = trunk-1-auth");

    const withoutAuth = build([trunk({})]);
    expect(withoutAuth).not.toContain("type = auth");
    expect(withoutAuth).not.toContain("outbound_auth");
  });

  it("strips separators from a phone-like from_user", () => {
    const output = build([trunk({ fromUser: "+31 970 000 0000" })]);
    expect(output).toContain("from_user = +319700000000");
  });

  it("keeps alphanumeric from_user values intact", () => {
    const output = build([trunk({ fromUser: "acme-user" })]);
    expect(output).toContain("from_user = acme-user");
  });

  it("skips disabled trunks entirely", () => {
    const output = build([trunk({ enabled: false, inboundIps: ["192.0.2.10"] })]);
    expect(output).not.toContain("[trunk-1");
  });
});

describe("inbound route config generation", () => {
  const service = buildService();

  it("writes a DID with spaces without the spaces", () => {
    const output = (service as any).buildInboundRoutesConfig(
      [{ id: 1, did: "+31 970 000 0000", flowId: 1 } as InboundRouteEntity],
      [],
    );
    expect(output).toContain("exten => +319700000000,1,Stasis(callytics)");
    expect(output).not.toMatch(/exten => \+31 /);
  });

  it("skips a route whose DID is not a valid number", () => {
    const output = (service as any).buildInboundRoutesConfig(
      [{ id: 2, did: "abc def", flowId: 1 } as InboundRouteEntity],
      [],
    );
    expect(output).not.toContain("abc");
  });
});

describe("parsePjsipIdentifies", () => {
  it("parses AMI Command output", () => {
    const output = [
      "Output: ",
      "Output:  Identify:  <Identify/Endpoint...>",
      "Output:  Identify:  trunk-1-identify/trunk-1",
      "Output:       Match: 192.0.2.10/32",
      "Output:       Match: 198.51.100.0/24",
    ].join("\n");
    expect(parsePjsipIdentifies(output)).toEqual([
      {
        name: "trunk-1-identify",
        endpoint: "trunk-1",
        matches: ["192.0.2.10/32", "198.51.100.0/24"],
      },
    ]);
  });
});

describe("rtp range", () => {
  it("generates rtp.conf for the configured range", () => {
    const output = buildRtpConfig({ start: 10100, end: 10120 });
    expect(output).toContain("rtpstart=10100");
    expect(output).toContain("rtpend=10120");
  });

  it("reads the initial range from the environment", () => {
    expect(getEnvRtpRange({ RTP_PORT_START: "10100", RTP_PORT_END: "10120" } as NodeJS.ProcessEnv)).toEqual({
      start: 10100,
      end: 10120,
    });
  });

  it("falls back to 10000-20000 for an invalid environment range", () => {
    expect(getEnvRtpRange({ RTP_PORT_START: "10101", RTP_PORT_END: "10120" } as NodeJS.ProcessEnv)).toEqual({
      start: 10000,
      end: 20000,
    });
    expect(getEnvRtpRange({} as NodeJS.ProcessEnv)).toEqual({ start: 10000, end: 20000 });
  });

  it("validates ranges", () => {
    expect(validateRtpRange({ start: 10100, end: 10120 })).toBeNull();
    expect(validateRtpRange({ start: 10100, end: 10110 })).not.toBeNull();
    expect(validateRtpRange({ start: 10101, end: 10200 })).not.toBeNull();
  });
});
