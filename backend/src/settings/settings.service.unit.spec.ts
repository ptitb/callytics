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
    });
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
