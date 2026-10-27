import { BadRequestException } from '@nestjs/common';
import { TemplatesService } from './templates.service';

describe('TemplatesService.importDocument', () => {
  const document = {
    name: 'Imported',
    nodes: [
      { nodeKey: 'start', type: 'start', config: {} },
      { nodeKey: 'play', type: 'play_audio', config: { audio_file_id: 1 } },
      { nodeKey: 'transfer', type: 'transfer', config: { target_type: 'pstn', target_value: '+31000000000', trunk_id: 4 } },
      { nodeKey: 'menu', type: 'menu', config: { branches: ['1'], prompt_audio_file_id: 2 } },
    ],
    edges: [],
    subflows: [
      {
        parentNodeKey: 'menu',
        parentBranchKey: '1',
        name: 'Sub',
        nodes: [
          { nodeKey: 'start', type: 'start', config: {} },
          { nodeKey: 'queue', type: 'queue', config: { queue_id: 9 } },
        ],
        edges: [],
      },
    ],
  };

  function createService(existingRows: Record<string, number[]>) {
    const query = jest.fn(async (sql: string) => {
      const table = /FROM (\w+)/.exec(sql)![1];
      return (existingRows[table] ?? []).map((id) => ({ id }));
    });
    const manager = { query };
    const dataSource = { transaction: jest.fn(async (work: (m: unknown) => unknown) => work(manager)) };
    const flowsService = { createFromDocument: jest.fn(async () => ({ id: 42, name: 'Imported' })) };
    const service = new TemplatesService(dataSource as never, flowsService as never);
    return { service, flowsService, query };
  }

  it('creates the flow and warns about references missing on this installation', async () => {
    const { service, flowsService } = createService({ audio_files: [1], sip_trunks: [], queues: [] });

    const result = await service.importDocument(document);

    expect(flowsService.createFromDocument).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(42);
    expect(result.warnings).toEqual([
      'Imported, node "transfer": trunk 4 (trunk_id) does not exist on this installation',
      'Imported, node "menu": audio file 2 (prompt_audio_file_id) does not exist on this installation',
      'Sub, node "queue": queue 9 (queue_id) does not exist on this installation',
    ]);
  });

  it('returns no warnings when every reference exists', async () => {
    const { service } = createService({ audio_files: [1, 2], sip_trunks: [4], queues: [9] });
    expect((await service.importDocument(document)).warnings).toEqual([]);
  });

  it('rejects an invalid document before touching the database', async () => {
    const { service, flowsService } = createService({});
    await expect(service.importDocument({ nodes: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(flowsService.createFromDocument).not.toHaveBeenCalled();
  });
});
