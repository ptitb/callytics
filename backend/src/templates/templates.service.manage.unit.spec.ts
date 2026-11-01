import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemplatesService } from './templates.service';

describe('TemplatesService template management', () => {
  const exported = {
    format: 'callytics-flow',
    version: 1,
    name: 'Source',
    description: 'Source description',
    nodes: [{ nodeKey: 'start', type: 'start', config: {} }],
    edges: [],
  };

  function createService(rows: Array<Record<string, unknown>>) {
    const manager = { query: jest.fn(async () => []) };
    const dataSource = {
      query: jest.fn(async () => rows),
      transaction: jest.fn(async (work: (m: unknown) => unknown) => work(manager)),
    };
    const flowsService = {
      exportFlow: jest.fn(async () => exported),
      createFromDocument: jest.fn(async (_m: unknown, document: { name: string }) => ({ id: 77, name: document.name })),
      remove: jest.fn(async (id: number) => ({ data: { id, deleted: true as const } })),
    };
    const service = new TemplatesService(dataSource as never, flowsService as never);
    return { service, manager, flowsService };
  }

  describe('createTemplate', () => {
    it('defaults the name to the flow name and flags the new row as template', async () => {
      const { service, manager, flowsService } = createService([{ is_template: false }]);

      const result = await service.createTemplate({ flowId: 5, category: ' clinic ', description: 'Desc' });

      expect(result).toEqual({ id: 77, name: 'Source' });
      expect(flowsService.createFromDocument).toHaveBeenCalledWith(manager, expect.objectContaining({ name: 'Source' }));
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('is_template = true'), [77, 'clinic', 'Desc']);
    });

    it('uses the given name and stores empty metadata as null', async () => {
      const { service, manager } = createService([{ is_template: false }]);

      const result = await service.createTemplate({ flowId: 5, name: ' My Template ', category: '  ' });

      expect(result.name).toBe('My Template');
      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [77, null, null]);
    });

    it('rejects an unknown flow', async () => {
      const { service, flowsService } = createService([]);
      await expect(service.createTemplate({ flowId: 5 })).rejects.toBeInstanceOf(NotFoundException);
      expect(flowsService.exportFlow).not.toHaveBeenCalled();
    });

    it('rejects a flow that already is a template', async () => {
      const { service } = createService([{ is_template: true }]);
      await expect(service.createTemplate({ flowId: 5 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deleteTemplate', () => {
    it('deletes the template through the flow deletion', async () => {
      const { service, flowsService } = createService([{ id: 9 }]);
      await expect(service.deleteTemplate(9)).resolves.toEqual({ id: 9, deleted: true });
      expect(flowsService.remove).toHaveBeenCalledWith(9);
    });

    it('does not delete rows that are not templates', async () => {
      const { service, flowsService } = createService([]);
      await expect(service.deleteTemplate(9)).rejects.toBeInstanceOf(NotFoundException);
      expect(flowsService.remove).not.toHaveBeenCalled();
    });
  });

  describe('importTemplate', () => {
    it('creates a draft copy including submenus under a copy name', async () => {
      const { service, manager, flowsService } = createService([{ name: 'Tpl', has_submenus: true }]);

      const result = await service.importTemplate(9);

      expect(result).toEqual({ id: 77, name: 'Tpl (copy)' });
      expect(flowsService.exportFlow).toHaveBeenCalledWith(9);
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("status = 'draft'"), [77]);
    });

    it('rejects an unknown template', async () => {
      const { service } = createService([]);
      await expect(service.importTemplate(9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
