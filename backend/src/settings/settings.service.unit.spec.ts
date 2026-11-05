import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { SettingsEntity } from './settings.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  const dataSource = {
    query: jest.fn(),
  };
  const settingsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
  };
  const trunksRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(SettingsEntity), useValue: settingsRepository },
        { provide: getRepositoryToken(SipTrunkEntity), useValue: trunksRepository },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('returns settings as a flat key-value object', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'recording_retention_days'
        ? { id: 3, key: 'recording_retention_days', value: '0' }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'true' }
          : { id: 1, key: 'default_outbound_trunk_id', value: '7' }
    ));
    settingsRepository.find.mockResolvedValue([
      { id: 1, key: 'default_outbound_trunk_id', value: '7' },
      { id: 2, key: 'record_outbound_calls', value: 'true' },
      { id: 3, key: 'recording_retention_days', value: '0' },
    ]);

    await expect(service.getAll()).resolves.toEqual({
      default_outbound_trunk_id: 7,
      record_outbound_calls: true,
      recording_retention_days: 0,
    });
  });

  it('rejects an RTP range with an odd start port', async () => {
    settingsRepository.findOne.mockResolvedValue(null);
    settingsRepository.find.mockResolvedValue([]);
    settingsRepository.create.mockImplementation((value: object) => value);

    await expect(service.updateMany({ rtp_port_start: 10101, rtp_port_end: 10200 })).rejects.toThrow(
      'RTP start port must be an even number',
    );
    expect(settingsRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ value: '10101' }));
  });

  it('rejects an RTP range where the end lies before the start', async () => {
    settingsRepository.findOne.mockResolvedValue(null);
    settingsRepository.find.mockResolvedValue([]);
    settingsRepository.create.mockImplementation((value: object) => value);

    await expect(service.updateMany({ rtp_port_start: 10200, rtp_port_end: 10100 })).rejects.toThrow(BadRequestException);
  });

  it('rejects update when the default trunk does not exist', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'default_outbound_trunk_id'
        ? { id: 1, key: 'default_outbound_trunk_id', value: null }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'false' }
          : { id: 3, key: 'recording_retention_days', value: '0' }
    ));
    trunksRepository.findOne.mockResolvedValue(null);

    const debugSpy = jest.spyOn(service['logger'], 'debug').mockImplementation();
    try {
      await expect(service.updateMany({ default_outbound_trunk_id: 99 })).rejects.toThrow(BadRequestException);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('returns null from getDefaultTrunk when the configured trunk is disabled or missing', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'default_outbound_trunk_id'
        ? { id: 1, key: 'default_outbound_trunk_id', value: '4' }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'false' }
          : { id: 3, key: 'recording_retention_days', value: '0' }
    ));
    trunksRepository.findOne.mockResolvedValue(null);

    await expect(service.getDefaultTrunk()).resolves.toEqual({ data: null });
  });
});

describe('SettingsService outbound dialing settings', () => {
  let service: SettingsService;
  const settingsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value: object) => value),
    merge: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => ({ key: where.key, value: 'y' }));
    settingsRepository.find.mockResolvedValue([]);
    settingsRepository.merge.mockImplementation((entity: object, patch: object) => ({ ...entity, ...patch }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getDataSourceToken(), useValue: { query: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: settingsRepository },
        { provide: getRepositoryToken(SipTrunkEntity), useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(SettingsService);
  });

  it('seeds the outbound defaults', async () => {
    settingsRepository.findOne.mockResolvedValue(null);
    await service.get('outbound_country_code');
    const seeded = Object.fromEntries(
      settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string }]) => [row.key, row.value]),
    );
    expect(seeded).toMatchObject({
      outbound_dial_without_hash: 'true',
      outbound_normalize_e164: 'true',
      outbound_country_code: '31',
      outbound_international_prefix: '00',
      outbound_wait_audio: 'ringback',
      outbound_min_number_length: '0',
      outbound_allowed_short_numbers: '112',
      record_internal_calls: 'false',
      hold_sound: 'moh',
      transfer_ringing_sound: 'ringback',
    });
  });

  it('reads the hold settings with the right types and falls back for bad values', async () => {
    settingsRepository.find.mockResolvedValue([
      { key: 'hold_sound', value: 'audio' },
      { key: 'hold_audio_file_id', value: '12' },
      { key: 'transfer_ringing_sound', value: 'hold' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      hold_sound: 'audio',
      hold_audio_file_id: 12,
      transfer_ringing_sound: 'hold',
    });
    settingsRepository.find.mockResolvedValue([
      { key: 'hold_sound', value: 'beep' },
      { key: 'hold_audio_file_id', value: 'abc' },
      { key: 'transfer_ringing_sound', value: '' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      hold_sound: 'moh',
      hold_audio_file_id: null,
      transfer_ringing_sound: 'ringback',
    });
  });

  it('saves the hold settings', async () => {
    await service.updateMany({ hold_sound: 'audio', hold_audio_file_id: 12, transfer_ringing_sound: 'none' });
    const saved = settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string }]) => [row.key, row.value]);
    expect(saved).toEqual(expect.arrayContaining([
      ['hold_sound', 'audio'],
      ['hold_audio_file_id', '12'],
      ['transfer_ringing_sound', 'none'],
    ]));
  });

  it('requires an audio file when the hold sound is audio', async () => {
    await expect(service.updateMany({ hold_sound: 'audio' })).rejects.toThrow(
      'hold_audio_file_id is required when hold_sound is audio',
    );
    await expect(service.updateMany({ hold_sound: 'audio', hold_audio_file_id: null })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts clearing the audio file when the hold sound is not audio', async () => {
    await service.updateMany({ hold_sound: 'moh', hold_audio_file_id: null });
    const saved = settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string | null }]) => [row.key, row.value]);
    expect(saved).toEqual(expect.arrayContaining([['hold_audio_file_id', null]]));
  });

  it('reads stored outbound settings with the right types', async () => {
    settingsRepository.find.mockResolvedValue([
      { key: 'outbound_dial_without_hash', value: 'false' },
      { key: 'outbound_normalize_e164', value: 'true' },
      { key: 'outbound_country_code', value: '44' },
      { key: 'outbound_international_prefix', value: '011' },
      { key: 'outbound_wait_audio', value: 'moh' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      outbound_dial_without_hash: false,
      outbound_normalize_e164: true,
      outbound_country_code: '44',
      outbound_international_prefix: '011',
      outbound_wait_audio: 'moh',
    });
  });

  it('reads the short number and internal recording settings with the right types', async () => {
    settingsRepository.find.mockResolvedValue([
      { key: 'outbound_min_number_length', value: '6' },
      { key: 'outbound_allowed_short_numbers', value: '112,911' },
      { key: 'record_internal_calls', value: 'true' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      outbound_min_number_length: 6,
      outbound_allowed_short_numbers: '112,911',
      record_internal_calls: true,
    });
  });

  it('keeps an empty allowed short numbers list empty and falls back for bad stored values', async () => {
    settingsRepository.find.mockResolvedValue([
      { key: 'outbound_min_number_length', value: 'abc' },
      { key: 'outbound_allowed_short_numbers', value: '' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      outbound_min_number_length: 0,
      outbound_allowed_short_numbers: '',
    });
    settingsRepository.find.mockResolvedValue([
      { key: 'outbound_min_number_length', value: '' },
      { key: 'outbound_allowed_short_numbers', value: '11a' },
    ]);
    await expect(service.getAll()).resolves.toEqual({
      outbound_min_number_length: 0,
      outbound_allowed_short_numbers: '112',
    });
  });

  it('saves the short number and internal recording settings', async () => {
    await service.updateMany({
      outbound_min_number_length: 6,
      outbound_allowed_short_numbers: ' 112, 911 ,,',
      record_internal_calls: true,
    });
    const saved = settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string }]) => [row.key, row.value]);
    expect(saved).toEqual(expect.arrayContaining([
      ['outbound_min_number_length', '6'],
      ['outbound_allowed_short_numbers', '112,911'],
      ['record_internal_calls', 'true'],
    ]));
  });

  it('accepts an empty allowed short numbers list', async () => {
    await service.updateMany({ outbound_allowed_short_numbers: '' });
    const saved = settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string }]) => [row.key, row.value]);
    expect(saved).toEqual(expect.arrayContaining([['outbound_allowed_short_numbers', '']]));
  });

  it('saves valid outbound settings', async () => {
    await service.updateMany({
      outbound_dial_without_hash: false,
      outbound_normalize_e164: false,
      outbound_country_code: '44',
      outbound_international_prefix: '011',
      outbound_wait_audio: 'moh',
    });
    const saved = settingsRepository.save.mock.calls.map(([row]: [{ key: string; value: string }]) => [row.key, row.value]);
    expect(saved).toEqual(expect.arrayContaining([
      ['outbound_dial_without_hash', 'false'],
      ['outbound_normalize_e164', 'false'],
      ['outbound_country_code', '44'],
      ['outbound_international_prefix', '011'],
      ['outbound_wait_audio', 'moh'],
    ]));
  });

  it.each([
    ['outbound_dial_without_hash', 'yes'],
    ['outbound_normalize_e164', 1],
    ['outbound_country_code', ''],
    ['outbound_country_code', '+31'],
    ['outbound_country_code', '3100'],
    ['outbound_country_code', '031'],
    ['outbound_country_code', 31],
    ['outbound_international_prefix', ''],
    ['outbound_international_prefix', '00000'],
    ['outbound_international_prefix', '0a'],
    ['outbound_international_prefix', null],
    ['outbound_wait_audio', 'beep'],
    ['outbound_wait_audio', ''],
    ['outbound_wait_audio', true],
    ['outbound_wait_audio', null],
    ['outbound_min_number_length', -1],
    ['outbound_min_number_length', 2.5],
    ['outbound_min_number_length', 21],
    ['outbound_min_number_length', '6'],
    ['outbound_min_number_length', null],
    ['outbound_allowed_short_numbers', '112;911'],
    ['outbound_allowed_short_numbers', '11a'],
    ['outbound_allowed_short_numbers', '+112'],
    ['outbound_allowed_short_numbers', 112],
    ['outbound_allowed_short_numbers', null],
    ['record_internal_calls', 'yes'],
    ['record_internal_calls', null],
    ['hold_sound', 'music'],
    ['hold_sound', null],
    ['hold_audio_file_id', 0],
    ['hold_audio_file_id', 1.5],
    ['hold_audio_file_id', '3'],
    ['transfer_ringing_sound', 'beep'],
    ['transfer_ringing_sound', null],
  ])('rejects %s = %p', async (key, value) => {
    await expect(service.updateMany({ [key]: value as never })).rejects.toThrow(BadRequestException);
  });
});

describe('SettingsService outbound_wait_audio fallback', () => {
  it('reads an unknown stored value as the default', async () => {
    const repo = {
      findOne: jest.fn(),
      create: jest.fn((value: object) => value),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([{ key: 'outbound_wait_audio', value: 'beep' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getDataSourceToken(), useValue: { query: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: repo },
        { provide: getRepositoryToken(SipTrunkEntity), useValue: { findOne: jest.fn() } },
      ],
    }).compile();
    await expect(module.get(SettingsService).getAll()).resolves.toEqual({ outbound_wait_audio: 'ringback' });
  });
});
