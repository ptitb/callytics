import { readFile } from 'fs/promises';
import { join } from 'path';
import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, getTestDb, truncateAll } from '../../test/helpers';

type App = Awaited<ReturnType<typeof getApp>>;

const START = { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} };
const HANGUP = { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 100, positionY: 0, config: {} };

async function createFlow(app: App, payload: Record<string, unknown>): Promise<number> {
  const response = await request(app.getHttpServer()).post('/flows').send(payload);
  expect(response.status).toBe(201);
  return Number(response.body.data.id);
}

/** Root flow with a menu whose branch 1 has a submenu. */
async function createFlowWithSubmenu(app: App): Promise<number> {
  const rootId = await createFlow(app, {
    name: 'Reception',
    nodes: [
      START,
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Menu',
        positionX: 0,
        positionY: 100,
        config: { branches: ['1'], prompt_audio_file_id: 1 },
      },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default' }],
  });
  await createFlow(app, {
    name: 'Sales submenu',
    parentFlowId: rootId,
    parentNodeKey: 'menu-1',
    parentBranchKey: '1',
    nodes: [START, HANGUP],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default' }],
  });
  return rootId;
}

async function countFlows(): Promise<number> {
  const db = await getTestDb();
  const result = await db.query('SELECT COUNT(*)::int AS count FROM call_flows');
  return result.rows[0].count;
}

describe('Template management API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('POST /templates', () => {
    it('saves a flow with its submenus as a template and leaves the original untouched', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);
      const before = await request(app.getHttpServer()).get(`/flows/${rootId}`);

      const response = await request(app.getHttpServer())
        .post('/templates')
        .send({ flowId: rootId, name: 'Reception template', category: 'office', description: 'Menu with sales' });

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({ id: expect.any(Number), name: 'Reception template' });
      const templateId = Number(response.body.data.id);
      expect(templateId).not.toBe(rootId);

      const db = await getTestDb();
      const rows = await db.query(
        'SELECT is_template, template_category, template_description FROM call_flows WHERE id = $1',
        [templateId],
      );
      expect(rows.rows[0]).toEqual({
        is_template: true,
        template_category: 'office',
        template_description: 'Menu with sales',
      });
      const flags = await db.query('SELECT COUNT(*)::int AS count FROM call_flows WHERE is_template = true AND parent_flow_id IS NOT NULL');
      expect(flags.rows[0].count).toBe(0);

      const templateTree = await request(app.getHttpServer()).get(`/flows/${templateId}/tree`);
      expect(templateTree.body.data.children).toHaveLength(1);
      expect(templateTree.body.data.children[0]).toMatchObject({ nodeKey: 'menu-1', branchKey: '1', name: 'Sales submenu' });

      const after = await request(app.getHttpServer()).get(`/flows/${rootId}`);
      expect(after.body.data).toEqual(before.body.data);

      const list = await request(app.getHttpServer()).get('/templates');
      expect(list.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: templateId, name: 'Reception template', templateCategory: 'office', nodeCount: 2 }),
      ]));
    });

    it('defaults the name to the flow name', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);

      const response = await request(app.getHttpServer()).post('/templates').send({ flowId: rootId });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Reception');
    });

    it('keeps templates and their submenus out of the flows list', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);
      await request(app.getHttpServer()).post('/templates').send({ flowId: rootId });

      const response = await request(app.getHttpServer()).get('/flows?limit=50');

      expect(response.body.data.map((flow: { id: number }) => flow.id)).toEqual([rootId]);
    });

    it('rejects an unknown flow, a template and invalid input', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);
      const template = await request(app.getHttpServer()).post('/templates').send({ flowId: rootId });

      expect((await request(app.getHttpServer()).post('/templates').send({ flowId: 9999 })).status).toBe(404);
      expect(
        (await request(app.getHttpServer()).post('/templates').send({ flowId: template.body.data.id })).status,
      ).toBe(400);
      expect((await request(app.getHttpServer()).post('/templates').send({})).status).toBe(400);
      expect(
        (await request(app.getHttpServer()).post('/templates').send({ flowId: rootId, name: 'x'.repeat(121) })).status,
      ).toBe(400);
    });
  });

  describe('POST /templates/:id/import', () => {
    it('copies the submenus of a template into the new flow', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);
      const template = await request(app.getHttpServer()).post('/templates').send({ flowId: rootId });

      const response = await request(app.getHttpServer()).post(`/templates/${template.body.data.id}/import`).send({});

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Reception (copy)');
      const tree = await request(app.getHttpServer()).get(`/flows/${response.body.data.id}/tree`);
      expect(tree.body.data.children).toHaveLength(1);
      const db = await getTestDb();
      const rows = await db.query('SELECT status, is_template FROM call_flows WHERE id = $1', [response.body.data.id]);
      expect(rows.rows[0]).toEqual({ status: 'draft', is_template: false });
    });
  });

  describe('bundled templates', () => {
    it('can all be imported', async () => {
      const app = await getApp();
      // truncateAll removed the seeded templates, so run the seed migration again.
      const db = await getTestDb();
      await db.query(await readFile(join(__dirname, '..', '..', 'migrations', '016_phase19.sql'), 'utf8'));
      const list = await request(app.getHttpServer()).get('/templates');
      expect(list.body.data.length).toBeGreaterThan(0);

      for (const template of list.body.data as Array<{ id: number }>) {
        const response = await request(app.getHttpServer()).post(`/templates/${template.id}/import`).send({});
        expect(response.status).toBe(201);
      }
    });
  });

  describe('DELETE /templates/:id', () => {
    it('deletes a template together with its submenus', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);
      const template = await request(app.getHttpServer()).post('/templates').send({ flowId: rootId });
      expect(await countFlows()).toBe(4);

      const response = await request(app.getHttpServer()).delete(`/templates/${template.body.data.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ id: template.body.data.id, deleted: true });
      expect(await countFlows()).toBe(2);
      expect((await request(app.getHttpServer()).get(`/flows/${rootId}`)).status).toBe(200);
    });

    it('refuses to delete a regular flow', async () => {
      const app = await getApp();
      const rootId = await createFlowWithSubmenu(app);

      const response = await request(app.getHttpServer()).delete(`/templates/${rootId}`);

      expect(response.status).toBe(404);
      expect(await countFlows()).toBe(2);
    });
  });
});
