import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { CallRecordingEntity } from './entities/call-recording.entity';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { promises as fs } from 'fs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListRecordingsQueryDto } from './dto/list-recordings-query.dto';

describe('RecordingsService', () => {
  let service: RecordingsService;
  let recordingsRepo: any;
  let flowsRepo: any;

  const mockRecordingsRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
  };

  const mockFlowsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    mockDataSource.query.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        { provide: getRepositoryToken(CallRecordingEntity), useValue: mockRecordingsRepo },
        { provide: getRepositoryToken(CallFlowEntity), useValue: mockFlowsRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
    recordingsRepo = module.get(getRepositoryToken(CallRecordingEntity));
    flowsRepo = module.get(getRepositoryToken(CallFlowEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    const baseRow = {
      id: 1,
      call_id: 'call-1',
      channel_id: 'chan-1',
      flow_id: null,
      file_name: 'rec.wav',
      file_path: '/var/lib/asterisk/recording/rec.wav',
      format: 'wav',
      duration_seconds: 12,
      started_at: new Date('2026-10-31T09:41:00Z'),
      ended_at: null,
      created_at: new Date('2026-10-31T09:41:12Z'),
      source: 'inbound',
      number: '+31612345678',
      operator: null,
    };

    const mockListQueries = (rows: any[], total = rows.length) => {
      mockDataSource.query.mockImplementation(async (sql: string) =>
        sql.includes('COUNT(*)') ? [{ total: String(total) }] : rows,
      );
    };
    const dataQueryCall = () => mockDataSource.query.mock.calls.find(([sql]: [string]) => !sql.includes('COUNT(*)'))!;
    const countQueryCall = () => mockDataSource.query.mock.calls.find(([sql]: [string]) => sql.includes('COUNT(*)'))!;

    it('should return paginated recordings mapped from effective values', async () => {
      mockListQueries([baseRow], 41);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.list({ page: 2, limit: 10 });

      expect(result).toMatchObject({ total: 41, page: 2, limit: 10, totalPages: 5 });
      expect(result.data[0]).toEqual({
        id: 1,
        callId: 'call-1',
        channelId: 'chan-1',
        flowId: null,
        flowName: null,
        remoteNumber: '+31612345678',
        operatorLabel: null,
        fileName: 'rec.wav',
        filePath: '/var/lib/asterisk/recording/rec.wav',
        format: 'wav',
        recordingType: 'inbound',
        durationSeconds: 12,
        startedAt: '2026-10-31T09:41:00.000Z',
        endedAt: null,
        createdAt: '2026-10-31T09:41:12.000Z',
        streamUrl: '/recordings/1/stream',
      });
      const [, params] = dataQueryCall();
      expect(params).toEqual([10, 10]);
    });

    it('should resolve flow names', async () => {
      mockListQueries([{ ...baseRow, flow_id: 7 }]);
      mockFlowsRepo.find.mockResolvedValue([{ id: 7, name: 'Main flow' }]);

      const result = await service.list();

      expect(result.data[0].flowName).toBe('Main flow');
    });

    it('should join call logs and compute the effective source, number and operator in SQL', async () => {
      mockListQueries([]);

      await service.list();

      const [sql] = dataQueryCall();
      expect(sql).toContain('LEFT JOIN call_logs cl ON cl.call_uuid = r.call_id');
      expect(sql).toContain("cl.direction = 'outbound' THEN cl.callee_number ELSE cl.caller_number");
      expect(sql).toContain("CASE WHEN cl.direction = 'outbound' THEN NULLIF(cl.caller_number, '') END");
      expect(sql).toContain("= 'inbound' AND cl.direction = 'outbound' THEN 'outbound'");
    });

    it('should default to date descending with nulls last and no filters', async () => {
      mockListQueries([]);

      await service.list();

      const [sql, params] = dataQueryCall();
      expect(sql).toContain('ORDER BY rec.created_at DESC NULLS LAST, rec.id DESC');
      expect(sql).not.toContain('WHERE');
      expect(params).toEqual([20, 0]);
    });

    it.each([
      ['filename', 'call_id'],
      ['source', 'source'],
      ['number', 'number'],
      ['operator', 'operator'],
      ['duration', 'duration_seconds'],
      ['date', 'created_at'],
    ] as const)('should sort by %s', async (sort, column) => {
      mockListQueries([]);

      await service.list({ sort, order: 'asc' });

      expect(dataQueryCall()[0]).toContain(`ORDER BY rec.${column} ASC NULLS LAST, rec.id DESC`);
    });

    it('should ignore a sort field outside the whitelist instead of interpolating it', async () => {
      mockListQueries([]);

      await service.list({ sort: 'id; DROP TABLE call_recordings' as any, order: 'sideways' as any });

      const [sql] = dataQueryCall();
      expect(sql).toContain('ORDER BY rec.created_at DESC NULLS LAST');
      expect(sql).not.toContain('DROP TABLE');
    });

    it('should apply all filters to both the count and the page query with bound parameters', async () => {
      mockListQueries([]);

      await service.list({
        search: ' 3161 ',
        source: 'outbound',
        dateFrom: '2026-10-01T00:00:00.000Z',
        dateTo: '2026-10-31T23:59:59.999Z',
        page: 3,
        limit: 5,
      });

      const [countSql, countParams] = countQueryCall();
      const [dataSql, dataParams] = dataQueryCall();
      for (const sql of [countSql, dataSql]) {
        expect(sql).toContain('rec.number ILIKE $1');
        expect(sql).toContain('rec.operator ILIKE $1');
        expect(sql).toContain('rec.file_name ILIKE $1');
        expect(sql).toContain('rec.call_id ILIKE $1');
        expect(sql).toContain('rec.source = $2');
        expect(sql).toContain('rec.created_at >= $3::timestamptz');
        expect(sql).toContain('rec.created_at <= $4::timestamptz');
      }
      expect(countParams).toEqual(['%3161%', 'outbound', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z']);
      expect(dataParams).toEqual(['%3161%', 'outbound', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z', 5, 10]);
    });

    it('should escape LIKE wildcards in the search text', async () => {
      mockListQueries([]);

      await service.list({ search: '50%_a\\b' });

      expect(dataQueryCall()[1][0]).toBe('%50\\%\\_a\\\\b%');
    });

    it('should ignore a blank search', async () => {
      mockListQueries([]);

      await service.list({ search: '   ' });

      expect(dataQueryCall()[0]).not.toContain('ILIKE');
    });

    it('should return totalPages of at least 1 when nothing matches', async () => {
      mockListQueries([], 0);

      const result = await service.list({ search: 'nothing' });

      expect(result).toMatchObject({ data: [], total: 0, totalPages: 1 });
    });
  });

  describe('ListRecordingsQueryDto validation', () => {
    const validateQuery = async (plain: Record<string, unknown>) =>
      validate(plainToInstance(ListRecordingsQueryDto, plain), { whitelist: true, forbidNonWhitelisted: true });

    it('should accept a full valid query and coerce numbers', async () => {
      const plain = { page: '2', limit: '10', search: 'abc', source: 'voicemail', dateFrom: '2026-10-01T00:00:00.000Z', dateTo: '2026-10-31T23:59:59.999Z', sort: 'duration', order: 'asc' };
      expect(await validateQuery(plain)).toHaveLength(0);
      expect(plainToInstance(ListRecordingsQueryDto, plain)).toMatchObject({ page: 2, limit: 10 });
    });

    it('should accept an empty query', async () => {
      expect(await validateQuery({})).toHaveLength(0);
    });

    it.each([
      ['source', 'fax'],
      ['sort', 'file_path'],
      ['order', 'up'],
      ['dateFrom', 'yesterday'],
      ['dateTo', 'not-a-date'],
      ['page', '0'],
      ['page', 'abc'],
      ['limit', '1000'],
      ['search', 'x'.repeat(101)],
      ['unknown', 'x'],
    ])('should reject %s=%s', async (key, value) => {
      const errors = await validateQuery({ [key]: value });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('getOne', () => {
    it('should return a recording', async () => {
      const item = { id: 1, callId: 'call-1', startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.findOne.mockResolvedValue(item);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.getOne(1);

      expect(result.data.id).toBe(1);
    });

    it('should throw NotFoundException if not found', async () => {
      recordingsRepo.findOne.mockResolvedValue(null);
      await expect(service.getOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createInternal', () => {
    it('should create a recording record', async () => {
      const dto = {
        callId: 'call-1',
        channelId: 'chan-1',
        fileName: 'test.wav',
        filePath: '/tmp/test.wav',
        format: 'wav',
        startedAt: new Date().toISOString(),
      };
      const entity = { ...dto, id: 1, startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.create.mockReturnValue(entity);
      recordingsRepo.save.mockResolvedValue(entity);
      recordingsRepo.findOne.mockResolvedValue(entity);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.createInternal(dto);

      expect(result.data.id).toBe(1);
    });

    it('should store remote number and operator label', async () => {
      const dto = {
        callId: 'call-1',
        channelId: 'chan-1',
        fileName: 'test.wav',
        filePath: '/tmp/test.wav',
        format: 'wav',
        startedAt: new Date().toISOString(),
        remoteNumber: '+31612345678',
        operatorLabel: '101',
      };
      const entity = { ...dto, id: 1, startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.create.mockReturnValue(entity);
      recordingsRepo.save.mockResolvedValue(entity);
      recordingsRepo.findOne.mockResolvedValue(entity);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.createInternal(dto);

      expect(recordingsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ remoteNumber: '+31612345678', operatorLabel: '101' }),
      );
      expect(result.data.remoteNumber).toBe('+31612345678');
      expect(result.data.operatorLabel).toBe('101');
    });

    it('should default recording type to inbound and accept outbound', async () => {
      const dto = {
        callId: 'call-1',
        channelId: 'chan-1',
        fileName: 'test.wav',
        filePath: '/tmp/test.wav',
        format: 'wav',
        startedAt: new Date().toISOString(),
      };
      const entity = { ...dto, id: 1, startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.create.mockReturnValue(entity);
      recordingsRepo.save.mockResolvedValue(entity);
      recordingsRepo.findOne.mockResolvedValue(entity);
      mockFlowsRepo.find.mockResolvedValue([]);

      await service.createInternal(dto);
      expect(recordingsRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ recordingType: 'inbound' }));

      await service.createInternal({ ...dto, recordingType: 'outbound' });
      expect(recordingsRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ recordingType: 'outbound' }));
    });

    it('should throw BadRequestException for invalid filename', async () => {
      await expect(service.createInternal({ fileName: '../invalid' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getFilePath', () => {
    it('should return file path if file exists', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);

      const result = await service.getFilePath(1);

      expect(result).toBe('/tmp/test.wav');
    });

    it('should throw NotFoundException if file does not exist', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('no access'));

      await expect(service.getFilePath(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove recording record and file', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(recordingsRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });

    it('should ignore ENOENT error on unlink', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      const error = new Error() as any;
      error.code = 'ENOENT';
      jest.spyOn(fs, 'unlink').mockRejectedValue(error);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
    });

    it('should throw InternalServerErrorException on other unlink errors', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'unlink').mockRejectedValue(new Error('other'));

      await expect(service.remove(1)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
