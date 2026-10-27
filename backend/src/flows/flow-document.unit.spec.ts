import { BadRequestException } from '@nestjs/common';
import {
  buildExportDocument,
  collectConfigReferences,
  FlowExportSource,
  parseFlowDocument,
} from './flow-document';

const OWNER_EXAMPLE = {
  name: 'My Flow',
  nodes: [
    { nodeKey: 'start', type: 'start', label: 'Start', config: {}, positionX: 100, positionY: 100 },
    { nodeKey: 'play_audio-1', type: 'play_audio', label: 'Welcome', config: { audio_file_id: '1' }, positionX: 100, positionY: 250 },
  ],
  edges: [{ sourceNodeKey: 'start', targetNodeKey: 'play_audio-1', branchKey: 'default' }],
};

function parseError(raw: unknown): string {
  try {
    parseFlowDocument(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error('expected parseFlowDocument to throw');
}

describe('buildExportDocument', () => {
  const source: FlowExportSource = {
    name: 'Main',
    description: null,
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {}, positionX: 1, positionY: 2, groupId: null },
      { nodeKey: 'menu-1', type: 'menu', label: null, config: { branches: ['1'] }, positionX: 3, positionY: 4, groupId: 'g1' },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null, sourceHandle: null, targetHandle: 'in' },
    ],
    subflows: [
      {
        parentNodeKey: 'menu-1',
        parentBranchKey: '1',
        flow: {
          name: 'Sales',
          nodes: [{ nodeKey: 'start', type: 'start', config: {}, positionX: 0, positionY: 0 }],
          edges: [],
          subflows: [
            {
              parentNodeKey: 'menu-2',
              parentBranchKey: '2',
              flow: { name: 'Deep', nodes: [{ nodeKey: 'start', type: 'start' }], edges: [] },
            },
          ],
        },
      },
    ],
  };

  it('builds a document without database ids and without null fields', () => {
    const doc = buildExportDocument(source, new Date('2026-01-02T03:04:05.000Z'));

    expect(doc).toEqual({
      format: 'callytics-flow',
      version: 1,
      exportedAt: '2026-01-02T03:04:05.000Z',
      name: 'Main',
      nodes: [
        { nodeKey: 'start', type: 'start', label: 'Start', config: {}, positionX: 1, positionY: 2 },
        { nodeKey: 'menu-1', type: 'menu', config: { branches: ['1'] }, positionX: 3, positionY: 4, groupId: 'g1' },
      ],
      edges: [{ sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', targetHandle: 'in' }],
      subflows: [
        {
          parentNodeKey: 'menu-1',
          parentBranchKey: '1',
          name: 'Sales',
          nodes: [{ nodeKey: 'start', type: 'start', config: {}, positionX: 0, positionY: 0 }],
          edges: [],
          subflows: [
            {
              parentNodeKey: 'menu-2',
              parentBranchKey: '2',
              name: 'Deep',
              nodes: [{ nodeKey: 'start', type: 'start', config: {}, positionX: 0, positionY: 0 }],
              edges: [],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(doc)).not.toMatch(/"(id|subflowId|flowId|versionId)"/);
    expect(JSON.stringify(doc)).not.toContain('null');
  });

  it('omits subflows when there are none', () => {
    const doc = buildExportDocument({ name: 'Plain', description: 'Text', nodes: [], edges: [] });
    expect(doc).not.toHaveProperty('subflows');
    expect(doc.description).toBe('Text');
  });
});

describe('parseFlowDocument', () => {
  it('accepts the minimal example', () => {
    const parsed = parseFlowDocument(OWNER_EXAMPLE);

    expect(parsed.name).toBe('My Flow');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[1]).toMatchObject({ nodeKey: 'play_audio-1', config: { audio_file_id: '1' } });
    expect(parsed.edges[0]).toMatchObject({ sourceNodeKey: 'start', targetNodeKey: 'play_audio-1', branchKey: 'default' });
    expect(parsed.subflows).toEqual([]);
  });

  it('accepts the shape returned by GET /flows/:id and drops ids', () => {
    const parsed = parseFlowDocument({
      id: 7,
      name: 'Existing',
      description: null,
      slug: 'existing',
      parentFlowId: null,
      parentNodeKey: null,
      parentBranchKey: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versionId: 3,
      versionNumber: 1,
      nodes: [
        { id: 1, nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {}, groupId: null, subflowId: null },
        { id: 2, nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 0, positionY: 100, config: {}, groupId: null, subflowId: 9 },
      ],
      edges: [
        { id: 4, sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null, sourceHandle: null, targetHandle: null },
      ],
    });

    expect(parsed.name).toBe('Existing');
    expect(parsed.description).toBeUndefined();
    expect(parsed.nodes.every((node) => !('id' in node) && !('subflowId' in node))).toBe(true);
    expect(parsed.edges.every((edge) => !('id' in edge))).toBe(true);
  });

  it('falls back to "Imported Flow" when the name is missing or blank', () => {
    expect(parseFlowDocument({ ...OWNER_EXAMPLE, name: undefined }).name).toBe('Imported Flow');
    expect(parseFlowDocument({ ...OWNER_EXAMPLE, name: '   ' }).name).toBe('Imported Flow');
  });

  it('parses nested subflows and checks their links', () => {
    const menuNode = { nodeKey: 'menu-1', type: 'menu', config: { branches: ['1'] } };
    const parsed = parseFlowDocument({
      format: 'callytics-flow',
      version: 1,
      name: 'Tree',
      nodes: [{ nodeKey: 'start', type: 'start' }, menuNode],
      edges: [],
      subflows: [
        {
          parentNodeKey: 'menu-1',
          parentBranchKey: '1',
          name: 'Child',
          nodes: [{ nodeKey: 'start', type: 'start' }, menuNode],
          edges: [],
          subflows: [
            { parentNodeKey: 'menu-1', parentBranchKey: '2', nodes: [{ nodeKey: 'start', type: 'start' }], edges: [] },
          ],
        },
      ],
    });

    expect(parsed.subflows[0]).toMatchObject({ parentNodeKey: 'menu-1', parentBranchKey: '1', name: 'Child' });
    expect(parsed.subflows[0].subflows[0]).toMatchObject({ parentBranchKey: '2', name: 'Submenu menu-1 2' });
  });

  it.each([
    ['null', null, 'must be a JSON object'],
    ['an array', [], 'must be a JSON object'],
    ['a string', 'text', 'must be a JSON object'],
    ['missing nodes', { name: 'x' }, 'nodes must be a non-empty array'],
    ['empty nodes', { name: 'x', nodes: [] }, 'nodes must be a non-empty array'],
    ['an unsupported format', { ...OWNER_EXAMPLE, format: 'other' }, 'Unsupported format "other"'],
    ['an unsupported version', { ...OWNER_EXAMPLE, format: 'callytics-flow', version: 2 }, 'Unsupported version "2"'],
    [
      'an unknown node type',
      { name: 'x', nodes: [{ nodeKey: 'a', type: 'teleport' }], edges: [] },
      'nodes[0] (a): type must be one of the following values',
    ],
    [
      'a node without nodeKey',
      { name: 'x', nodes: [{ type: 'start' }], edges: [] },
      'nodes[0]: nodeKey must be a string',
    ],
    [
      'duplicate node keys',
      { name: 'x', nodes: [{ nodeKey: 'a', type: 'start' }, { nodeKey: 'a', type: 'hangup' }], edges: [] },
      'duplicate nodeKey "a"',
    ],
    [
      'an edge to a missing node',
      { name: 'x', nodes: [{ nodeKey: 'a', type: 'start' }], edges: [{ sourceNodeKey: 'a', targetNodeKey: 'zzz' }] },
      'edges[0]: target node "zzz" does not exist',
    ],
    [
      'a non-numeric position',
      { name: 'x', nodes: [{ nodeKey: 'a', type: 'start', positionX: 'left' }], edges: [] },
      'positionX must be a number',
    ],
    [
      'a subflow that is not linked to a menu node',
      {
        name: 'x',
        nodes: [{ nodeKey: 'a', type: 'start' }],
        edges: [],
        subflows: [{ parentNodeKey: 'a', parentBranchKey: '1', nodes: [{ nodeKey: 's', type: 'start' }], edges: [] }],
      },
      'subflows[0]: parentNodeKey "a" must be a menu node',
    ],
    [
      'a subflow with an unknown parent node',
      {
        name: 'x',
        nodes: [{ nodeKey: 'a', type: 'start' }],
        edges: [],
        subflows: [{ parentNodeKey: 'nope', parentBranchKey: '1', nodes: [{ nodeKey: 's', type: 'start' }], edges: [] }],
      },
      'does not match a node of the parent flow',
    ],
    [
      'a subflow with an invalid branch key',
      {
        name: 'x',
        nodes: [{ nodeKey: 'm', type: 'menu' }],
        edges: [],
        subflows: [{ parentNodeKey: 'm', parentBranchKey: 'abc', nodes: [{ nodeKey: 's', type: 'start' }], edges: [] }],
      },
      'parentBranchKey must be 1-2 digits, * or #',
    ],
    [
      'a subflow without nodes',
      {
        name: 'x',
        nodes: [{ nodeKey: 'm', type: 'menu' }],
        edges: [],
        subflows: [{ parentNodeKey: 'm', parentBranchKey: '1', edges: [] }],
      },
      'subflows[0].nodes must be a non-empty array',
    ],
  ])('rejects %s with a clear message', (_label, raw, expected) => {
    expect(parseError(raw)).toContain(expected);
  });

  it('reports several problems in one message', () => {
    const message = parseError({
      nodes: [{ nodeKey: 'a', type: 'teleport' }, { nodeKey: 'b', type: 'warp' }],
      edges: [],
    });
    expect(message).toContain('nodes[0] (a)');
    expect(message).toContain('nodes[1] (b)');
  });
});

describe('collectConfigReferences', () => {
  it('finds audio, trunk, queue, operator and extension references', () => {
    const references = collectConfigReferences([
      { nodeKey: 'play', config: { audio_file_id: '5' } },
      { nodeKey: 'menu', config: { prompt_audio_file_id: 6, timeout_prompt_audio_id: 7, branches: ['1'] } },
      { nodeKey: 'vm', config: { start_audio_id: 8, end_audio_id: 9 } },
      { nodeKey: 'queue_login', config: { queue_ids: [1, 2], login_success_audio_file_id: 3, wrong_pin_audio_file_id: 4 } },
      { nodeKey: 'queue', config: { queue_id: 11, prompt_audio_file_id: 12 } },
      { nodeKey: 'transfer', config: { target_type: 'pstn', target_value: '+31000000000', trunk_id: 2 } },
      {
        nodeKey: 'hunt',
        config: { destinations: [{ target_type: 'pstn', target_value: '+31000000000', trunk_id: 3 }], hold_audio_file_id: 13 },
      },
      { nodeKey: 'cb', config: { destination_trunk_id: 4, operator_id: 5 } },
      { nodeKey: 'conf-ext', config: { moderatorType: 'extension', moderatorId: 21 } },
      { nodeKey: 'conf-pstn', config: { moderatorType: 'pstn', moderatorId: 22, participants: [{ trunkId: 23 }] } },
    ]);

    const summary = references.map((reference) => `${reference.nodeKey}:${reference.configKey}:${reference.kind}:${reference.id}`);
    expect(summary).toEqual(expect.arrayContaining([
      'play:audio_file_id:audio file:5',
      'menu:prompt_audio_file_id:audio file:6',
      'menu:timeout_prompt_audio_id:audio file:7',
      'vm:start_audio_id:audio file:8',
      'vm:end_audio_id:audio file:9',
      'queue_login:queue_ids:queue:1',
      'queue_login:queue_ids:queue:2',
      'queue_login:login_success_audio_file_id:audio file:3',
      'queue:queue_id:queue:11',
      'transfer:trunk_id:trunk:2',
      'hunt:destinations[0].trunk_id:trunk:3',
      'hunt:hold_audio_file_id:audio file:13',
      'cb:destination_trunk_id:trunk:4',
      'cb:operator_id:operator:5',
      'conf-ext:moderatorId:extension:21',
      'conf-pstn:moderatorId:operator:22',
      'conf-pstn:participants[0].trunkId:trunk:23',
    ]));
  });

  it('ignores empty, zero and non-numeric values', () => {
    expect(collectConfigReferences([
      { nodeKey: 'a', config: { audio_file_id: null, queue_id: 0, trunk_id: '', operator_id: 'abc', moderatorId: null } },
      { nodeKey: 'b', config: undefined },
    ])).toEqual([]);
  });
});
