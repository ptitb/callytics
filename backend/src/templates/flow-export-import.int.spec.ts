import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, getTestDb, truncateAll } from '../../test/helpers';

type App = Awaited<ReturnType<typeof getApp>>;

const OWNER_EXAMPLE = {
  name: 'My Flow',
  nodes: [
    { nodeKey: 'start', type: 'start', label: 'Start', config: {}, positionX: 100, positionY: 100 },
    { nodeKey: 'play_audio-1', type: 'play_audio', label: 'Welcome', config: { audio_file_id: '1' }, positionX: 100, positionY: 250 },
  ],
  edges: [{ sourceNodeKey: 'start', targetNodeKey: 'play_audio-1', branchKey: 'default' }],
};

const START = { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} };

async function createFlow(app: App, payload: Record<string, unknown>): Promise<number> {
  const response = await request(app.getHttpServer()).post('/flows').send(payload);
  expect(response.status).toBe(201);
  return Number(response.body.data.id);
}

/** Root flow with a menu; branch 1 has a submenu that itself contains a menu with a branch 2 submenu. */
async function createFlowWithNestedSubmenus(app: App): Promise<number> {
  const rootId = await createFlow(app, {
    name: 'Round Trip',
    description: 'Flow with nested submenus',
    nodes: [
      { ...START, positionX: 120, positionY: 80, config: { flow_default_timeout_ms: 60000 } },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        positionX: 120,
        positionY: 240,
        config: { timeout_ms: 5000, branches: ['1', '2'], prompt_audio_file_id: 1, submenu_branch_names: { '1': 'Sales' } },
      },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 120, positionY: 400, config: {} },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default' },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'hangup', branchKey: '2', condition: '2' },
    ],
  });

  const salesId = await createFlow(app, {
    name: 'Sales submenu',
    parentFlowId: rootId,
    parentNodeKey: 'menu-1',
    parentBranchKey: '1',
    nodes: [
      START,
      {
        nodeKey: 'menu-sales',
        type: 'menu',
        label: 'Sales Menu',
        positionX: 150,
        positionY: 0,
        config: { branches: ['3'], prompt_audio_file_id: 2 },
      },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 300, positionY: 0, config: {} },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-sales', branchKey: 'default' },
      { sourceNodeKey: 'menu-sales', targetNodeKey: 'hangup', branchKey: '3', condition: '3' },
    ],
  });

  await createFlow(app, {
    name: 'Deep submenu',
    parentFlowId: salesId,
    parentNodeKey: 'menu-sales',
    parentBranchKey: '3',
    nodes: [
      START,
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 100, positionY: 0, config: {} },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default' }],
  });

  return rootId;
}

async function exportFlow(app: App, id: number) {
  const response = await request(app.getHttpServer()).get(`/flows/${id}/export`);
  expect(response.status).toBe(200);
  return response.body;
}

async function countFlows(): Promise<number> {
  const db = await getTestDb();
  const result = await db.query('SELECT COUNT(*)::int AS count FROM call_flows');
  return result.rows[0].count;
}

function withoutExportedAt<T extends { exportedAt: string }>(doc: T): Omit<T, 'exportedAt'> {
  const { exportedAt: _exportedAt, ...rest } = doc;
  return rest;
}

describe('Flow export and import API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('GET /flows/:id/export', () => {
    it('exports nested submenus linked by node key and branch, without database ids', async () => {
      const app = await getApp();
      const rootId = await createFlowWithNestedSubmenus(app);

      const doc = await exportFlow(app, rootId);

      expect(doc).toMatchObject({ format: 'callytics-flow', version: 1, name: 'Round Trip', description: 'Flow with nested submenus' });
      expect(new Date(doc.exportedAt).toISOString()).toBe(doc.exportedAt);
      expect(doc.nodes.map((node: { nodeKey: string }) => node.nodeKey)).toEqual(['start', 'menu-1', 'hangup']);
      expect(doc.subflows).toHaveLength(1);
      expect(doc.subflows[0]).toMatchObject({ parentNodeKey: 'menu-1', parentBranchKey: '1', name: 'Sales submenu' });
      expect(doc.subflows[0].subflows).toHaveLength(1);
      expect(doc.subflows[0].subflows[0]).toMatchObject({ parentNodeKey: 'menu-sales', parentBranchKey: '3', name: 'Deep submenu' });

      const text = JSON.stringify(doc);
      expect(text).not.toMatch(/"(id|subflowId|flowId|versionId|slug|parentFlowId)"/);
      expect(text).not.toContain('submenu_branch_flows');
      expect(text).not.toContain('null');
    });

    it('exports a submenu as a standalone flow without its parent link', async () => {
      const app = await getApp();
      const rootId = await createFlowWithNestedSubmenus(app);
      const tree = await request(app.getHttpServer()).get(`/flows/${rootId}/tree`);
      const salesId = tree.body.data.children[0].subflowId;

      const doc = await exportFlow(app, salesId);

      expect(doc.name).toBe('Sales submenu');
      expect(doc).not.toHaveProperty('parentNodeKey');
      expect(doc).not.toHaveProperty('parentBranchKey');
      expect(doc.subflows).toHaveLength(1);
      expect(doc.subflows[0]).toMatchObject({ parentNodeKey: 'menu-sales', parentBranchKey: '3' });
    });

    it('returns 404 for an unknown flow', async () => {
      const app = await getApp();
      const response = await request(app.getHttpServer()).get('/flows/9999/export');
      expect(response.status).toBe(404);
    });
  });

  describe('POST /templates/import', () => {
    it('round trips a flow with nested submenus and leaves the original untouched', async () => {
      const app = await getApp();
      const rootId = await createFlowWithNestedSubmenus(app);
      const originalBefore = await request(app.getHttpServer()).get(`/flows/${rootId}`);
      const originalDoc = await exportFlow(app, rootId);

      const imported = await request(app.getHttpServer()).post('/templates/import').send(originalDoc);

      expect(imported.status).toBe(201);
      expect(imported.body.data).toEqual({ id: expect.any(Number), name: 'Round Trip', warnings: expect.any(Array) });
      const newId = Number(imported.body.data.id);
      expect(newId).not.toBe(rootId);

      // Same portable structure after exporting the copy again.
      const copyDoc = await exportFlow(app, newId);
      expect(withoutExportedAt(copyDoc)).toEqual(withoutExportedAt(originalDoc));

      // Node keys, types, configs and edges of the root flow.
      const copy = await request(app.getHttpServer()).get(`/flows/${newId}`);
      const strip = (flow: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }) => ({
        nodes: flow.nodes.map((node) => {
          const config = { ...(node.config as Record<string, unknown>) };
          delete config.submenu_branch_flows;
          return { nodeKey: node.nodeKey, type: node.type, label: node.label, config, positionX: node.positionX, positionY: node.positionY };
        }),
        edges: flow.edges.map(({ id: _id, ...edge }) => edge),
      });
      expect(strip(copy.body.data)).toEqual(strip(originalBefore.body.data));

      // Submenu linkage points at new flows, not at the original ones.
      const originalTree = (await request(app.getHttpServer()).get(`/flows/${rootId}/tree`)).body.data;
      const copyTree = (await request(app.getHttpServer()).get(`/flows/${newId}/tree`)).body.data;
      expect(copyTree.children).toHaveLength(1);
      expect(copyTree.children[0]).toMatchObject({ nodeKey: 'menu-1', branchKey: '1', name: 'Sales submenu' });
      expect(copyTree.children[0].subflowId).not.toBe(originalTree.children[0].subflowId);
      expect(copyTree.children[0].children[0]).toMatchObject({ nodeKey: 'menu-sales', branchKey: '3', name: 'Deep submenu' });

      const copyMenu = copy.body.data.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'menu-1');
      expect(copyMenu.config.submenu_branch_flows['1'].flowId).toBe(copyTree.children[0].subflowId);

      const subflow = await request(app.getHttpServer()).get(`/flows/${copyTree.children[0].subflowId}`);
      expect(subflow.body.data).toMatchObject({ parentFlowId: newId, parentNodeKey: 'menu-1', parentBranchKey: '1' });

      // The version snapshot of the copy contains the full tree.
      const versions = await request(app.getHttpServer()).get(`/flows/${newId}/versions/${copy.body.data.versionId}`);
      expect(versions.body.data.snapshot.subflows).toHaveLength(1);
      expect(versions.body.data.snapshot.subflows[0].subflows).toHaveLength(1);

      // The original flow is unchanged.
      const originalAfter = await request(app.getHttpServer()).get(`/flows/${rootId}`);
      expect(originalAfter.body.data).toEqual(originalBefore.body.data);
      expect(await countFlows()).toBe(6);
    });

    it('imports the minimal example and warns about the missing audio file', async () => {
      const app = await getApp();

      const response = await request(app.getHttpServer()).post('/templates/import').send(OWNER_EXAMPLE);

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({
        id: expect.any(Number),
        name: 'My Flow',
        warnings: ['My Flow, node "play_audio-1": audio file 1 (audio_file_id) does not exist on this installation'],
      });
      const flow = await request(app.getHttpServer()).get(`/flows/${response.body.data.id}`);
      expect(flow.body.data.nodes.map((node: { nodeKey: string }) => node.nodeKey)).toEqual(['start', 'play_audio-1']);
      expect(flow.body.data.edges).toHaveLength(1);
    });

    it('does not warn when the referenced audio file exists', async () => {
      const app = await getApp();
      const db = await getTestDb();
      const audio = await db.query(`INSERT INTO audio_files (name, source_type) VALUES ('Greeting', 'upload') RETURNING id`);

      const response = await request(app.getHttpServer()).post('/templates/import').send({
        ...OWNER_EXAMPLE,
        nodes: [OWNER_EXAMPLE.nodes[0], { ...OWNER_EXAMPLE.nodes[1], config: { audio_file_id: audio.rows[0].id } }],
      });

      expect(response.status).toBe(201);
      expect(response.body.data.warnings).toEqual([]);
    });

    it('accepts the GET /flows/:id shape including ids and nested null fields', async () => {
      const app = await getApp();
      const rootId = await createFlowWithNestedSubmenus(app);
      const flow = await request(app.getHttpServer()).get(`/flows/${rootId}`);

      const response = await request(app.getHttpServer()).post('/templates/import').send(flow.body.data);

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Round Trip');
      // GET /flows/:id carries no submenu flows, so only the root flow is created.
      const copy = await request(app.getHttpServer()).get(`/flows/${response.body.data.id}`);
      expect(copy.body.data.nodes).toHaveLength(3);
      expect(copy.body.data.parentFlowId).toBeNull();
    });

    it('falls back to "Imported Flow" and allows duplicate names', async () => {
      const app = await getApp();
      const { name: _name, ...unnamed } = OWNER_EXAMPLE;

      const first = await request(app.getHttpServer()).post('/templates/import').send(unnamed);
      const second = await request(app.getHttpServer()).post('/templates/import').send(unnamed);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.data.name).toBe('Imported Flow');
      expect(second.body.data.name).toBe('Imported Flow');
    });

    it('rejects invalid documents with 400 and a clear message', async () => {
      const app = await getApp();
      const post = (body: unknown) => request(app.getHttpServer()).post('/templates/import').send(body as object);

      const missingNodes = await post({ name: 'x' });
      expect(missingNodes.status).toBe(400);
      expect(missingNodes.body.message).toContain('nodes must be a non-empty array');

      const badType = await post({ name: 'x', nodes: [{ nodeKey: 'a', type: 'teleport' }], edges: [] });
      expect(badType.status).toBe(400);
      expect(badType.body.message).toContain('type must be one of the following values');

      const badEdge = await post({ ...OWNER_EXAMPLE, edges: [{ sourceNodeKey: 'start', targetNodeKey: 'ghost' }] });
      expect(badEdge.status).toBe(400);
      expect(badEdge.body.message).toContain('target node "ghost" does not exist');

      const badFormat = await post({ ...OWNER_EXAMPLE, format: 'other-tool' });
      expect(badFormat.status).toBe(400);
      expect(badFormat.body.message).toContain('Unsupported format');

      const badVersion = await post({ ...OWNER_EXAMPLE, format: 'callytics-flow', version: 99 });
      expect(badVersion.status).toBe(400);
      expect(badVersion.body.message).toContain('Unsupported version');

      const notAnObject = await post([1, 2, 3]);
      expect(notAnObject.status).toBe(400);
      expect(notAnObject.body.message).toContain('must be a JSON object');

      expect(await countFlows()).toBe(0);
    });

    it('creates nothing when a submenu fails validation', async () => {
      const app = await getApp();
      const rootId = await createFlowWithNestedSubmenus(app);
      const doc = await exportFlow(app, rootId);
      const flowsBefore = await countFlows();
      // A play_audio node without audio_file_id passes parsing but fails the service validation.
      doc.subflows[0].subflows[0].nodes.push({ nodeKey: 'broken', type: 'play_audio', config: {}, positionX: 0, positionY: 0 });

      const response = await request(app.getHttpServer()).post('/templates/import').send(doc);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('audio_file_id is required');
      expect(await countFlows()).toBe(flowsBefore);
    });

    it('is not captured by POST /templates/:id/import', async () => {
      const app = await getApp();

      const literal = await request(app.getHttpServer()).post('/templates/import').send(OWNER_EXAMPLE);
      expect(literal.status).toBe(201);

      const nonNumeric = await request(app.getHttpServer()).post('/templates/abc/import').send({});
      expect(nonNumeric.status).toBe(400);
      expect(nonNumeric.body.message).toContain('numeric string is expected');

      const unknownTemplate = await request(app.getHttpServer()).post('/templates/9999/import').send({});
      expect(unknownTemplate.status).toBe(404);
    });
  });
});
