# SIP Trunks

SIP Trunks connect Callytics to external phone providers for inbound and outbound calling. You can store provider credentials, control whether a trunk is enabled, and configure the calling options needed for your provider.

Testing tools help confirm that a trunk can register, qualify, and place or receive calls before it is used in production routing. Trunk status is also visible in diagnostics so provider connectivity issues can be spotted quickly.

Trunks are used by flow transfers and outbound campaigns whenever calls need to reach the public telephone network.

## Capabilities

- Provider credential management
- Inbound IP matching (IP whitelisting) for providers that do not register
- Enable or disable trunks
- Connectivity testing
- Outbound trunk test calls
- Inbound trunk test calls
- Country configuration
- Codec configuration
- Trunk status in diagnostics
- PSTN routing for transfer nodes
- PSTN routing for outbound campaign calls

## Inbound IP matching

Some providers deliver calls from fixed IP addresses and do not register. Enter those addresses in **Inbound IP addresses** on the trunk form, one per line. IPv4 addresses and CIDR ranges are accepted. Callytics writes a `type=identify` section for the trunk, so Asterisk matches incoming calls from those addresses to the trunk. Leave the field empty when the provider registers or authenticates with credentials.

After saving, the trunk form shows whether the identify object is loaded in Asterisk (`pjsip show identifies`).

## Outbound authentication

When a username and password are filled in, Callytics generates an auth section and sets `outbound_auth` on the trunk endpoint, so providers that challenge outbound calls with digest authentication work. For presets that do not register (Twilio, Telnyx, Vonage, SignalWire) no registration is created. With the generic preset a registration is created as well.

## Phone numbers

DIDs of inbound routes and the From user of a trunk are stored without spaces or separators (`+31 970 000 0000` becomes `+319700000000`).
