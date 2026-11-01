import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  collectConfigReferences,
  ConfigReference,
  ConfigReferenceKind,
  formatMissingReferenceWarning,
  parseFlowDocument,
  ParsedFlowDocument,
} from '../flows/flow-document';
import { FlowsService } from '../flows/flows.service';
import { CreateTemplateDto } from './dto/create-template.dto';

const REFERENCE_TABLES: Record<ConfigReferenceKind, string> = {
  'audio file': 'audio_files',
  trunk: 'sip_trunks',
  queue: 'queues',
  operator: 'operators',
  extension: 'sip_extensions',
};

@Injectable()
export class TemplatesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly flowsService: FlowsService,
  ) {}

  async listTemplates() {
    const rows = await this.dataSource.query(
      `
        SELECT
          cf.id,
          cf.name,
          cf.description,
          cf.template_description AS "templateDescription",
          cf.template_category AS "templateCategory",
          COALESCE(fv.node_count, node_counts.node_count, 0) AS "nodeCount"
        FROM call_flows cf
        LEFT JOIN flow_versions fv ON fv.id = cf.current_version_id
        LEFT JOIN (
          SELECT flow_version_id, COUNT(*)::int AS node_count
          FROM flow_nodes
          GROUP BY flow_version_id
        ) node_counts ON node_counts.flow_version_id = cf.current_version_id
        WHERE cf.is_template = true
        ORDER BY cf.created_at DESC, cf.id DESC
      `,
    );

    return {
      data: rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        name: String(row.name || ''),
        description: row.description ? String(row.description) : null,
        templateDescription: row.templateDescription ? String(row.templateDescription) : null,
        templateCategory: row.templateCategory ? String(row.templateCategory) : null,
        nodeCount: Number(row.nodeCount || 0),
      })),
    };
  }

  /**
   * Imports a flow from an untrusted JSON document in a single transaction: either the
   * flow with all its submenus is created, or nothing is. References to rows that do not
   * exist on this installation (audio files, trunks, queues, ...) only produce warnings.
   */
  async importDocument(raw: unknown): Promise<{ id: number; name: string; warnings: string[] }> {
    const document = parseFlowDocument(raw);

    return this.dataSource.transaction(async (manager) => {
      const created = await this.flowsService.createFromDocument(manager, document);
      const warnings = await this.findMissingReferenceWarnings(manager, document);
      return { id: created.id, name: created.name, warnings };
    });
  }

  private async findMissingReferenceWarnings(
    manager: DataSource['manager'],
    document: ParsedFlowDocument,
  ): Promise<string[]> {
    const entries: Array<{ flowName: string; reference: ConfigReference }> = [];
    const visit = (flowName: string, nodes: ParsedFlowDocument['nodes'], subflows: ParsedFlowDocument['subflows']): void => {
      for (const reference of collectConfigReferences(nodes)) {
        entries.push({ flowName, reference });
      }
      for (const subflow of subflows) {
        visit(subflow.name, subflow.nodes, subflow.subflows);
      }
    };
    visit(document.name, document.nodes, document.subflows);

    const idsByKind = new Map<ConfigReferenceKind, Set<number>>();
    for (const { reference } of entries) {
      const ids = idsByKind.get(reference.kind) ?? new Set<number>();
      ids.add(reference.id);
      idsByKind.set(reference.kind, ids);
    }

    const existing = new Map<ConfigReferenceKind, Set<number>>();
    for (const [kind, ids] of idsByKind) {
      const rows: Array<{ id: number | string }> = await manager.query(
        `SELECT id FROM ${REFERENCE_TABLES[kind]} WHERE id = ANY($1::bigint[])`,
        [Array.from(ids)],
      );
      existing.set(kind, new Set(rows.map((row) => Number(row.id))));
    }

    return entries
      .filter(({ reference }) => !existing.get(reference.kind)?.has(reference.id))
      .map(({ flowName, reference }) => formatMissingReferenceWarning(reference, flowName));
  }

  /**
   * Saves a snapshot of a flow's current version (including its submenus) as a new template.
   * The source flow is not modified. The copy goes through the same export and import path as
   * "Import JSON", so it behaves like an imported flow, and is flagged as template in the same
   * transaction.
   */
  async createTemplate(dto: CreateTemplateDto): Promise<{ id: number; name: string }> {
    const rows: Array<{ is_template: boolean }> = await this.dataSource.query(
      `SELECT is_template FROM call_flows WHERE id = $1 LIMIT 1`,
      [dto.flowId],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Flow ${dto.flowId} not found`);
    }
    if (rows[0].is_template) {
      throw new BadRequestException(`Flow ${dto.flowId} is already a template`);
    }

    const document = parseFlowDocument(await this.flowsService.exportFlow(dto.flowId));
    const name = dto.name?.trim() || document.name;
    const category = dto.category?.trim() || null;
    const description = dto.description?.trim() || null;

    return this.dataSource.transaction(async (manager) => {
      const created = await this.flowsService.createFromDocument(manager, { ...document, name });
      await manager.query(
        `
          UPDATE call_flows
          SET is_template = true,
              template_category = $2,
              template_description = $3
          WHERE id = $1
        `,
        [created.id, category, description],
      );
      return { id: created.id, name: created.name };
    });
  }

  /** Deletes a template and its submenus. Regular flows cannot be deleted through this method. */
  async deleteTemplate(templateId: number): Promise<{ id: number; deleted: true }> {
    const rows = await this.dataSource.query(
      `SELECT id FROM call_flows WHERE id = $1 AND is_template = true LIMIT 1`,
      [templateId],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
    const result = await this.flowsService.remove(templateId);
    return result.data;
  }

  /**
   * Creates a new draft flow named "<template name> (copy)" from a template.
   *
   * Templates with submenus go through the export and import path of "Import JSON" so the whole
   * tree is copied. Templates without submenus (including the bundled ones, whose configs predate
   * the import validation) are copied row by row.
   */
  async importTemplate(templateId: number): Promise<{ id: number; name: string }> {
    const rows: Array<{ name: string | null; has_submenus: boolean }> = await this.dataSource.query(
      `
        SELECT
          cf.name,
          EXISTS (SELECT 1 FROM call_flows child WHERE child.parent_flow_id = cf.id) AS has_submenus
        FROM call_flows cf
        WHERE cf.id = $1
          AND cf.is_template = true
        LIMIT 1
      `,
      [templateId],
    );
    const template = rows[0];
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
    if (!template.has_submenus) {
      return this.importTemplateWithoutSubmenus(templateId);
    }

    const document = parseFlowDocument(await this.flowsService.exportFlow(templateId));
    const copyName = `${template.name || 'Template'} (copy)`;

    return this.dataSource.transaction(async (manager) => {
      const created = await this.flowsService.createFromDocument(manager, { ...document, name: copyName });
      await manager.query(`UPDATE call_flows SET status = 'draft' WHERE id = $1`, [created.id]);
      return created;
    });
  }

  private async importTemplateWithoutSubmenus(templateId: number): Promise<{ id: number; name: string }> {
    return this.dataSource.transaction(async (manager) => {
      const templateRows = await manager.query(
        `
          SELECT *
          FROM call_flows
          WHERE id = $1
            AND is_template = true
          LIMIT 1
        `,
        [templateId],
      );

      const template = templateRows[0] as Record<string, unknown> | undefined;
      if (!template) {
        throw new NotFoundException(`Template ${templateId} not found`);
      }

      const currentVersionId = Number(template.current_version_id || 0);
      if (currentVersionId <= 0) {
        throw new NotFoundException(`Template ${templateId} has no active version`);
      }

      const copyName = `${String(template.name || 'Template')} (copy)`;
      const baseSlug = `${String(template.slug || 'template')}-copy`;
      const slug = await this.ensureUniqueSlug(manager, baseSlug);

      const insertedFlowRows = await manager.query(
        `
          INSERT INTO call_flows (
            name,
            slug,
            description,
            status,
            entry_type,
            entry_value,
            parent_flow_id,
            parent_node_key,
            is_template,
            template_description,
            template_category,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'draft', 'default', NULL, NULL, NULL, false, NULL, NULL, NOW(), NOW())
          RETURNING id, name
        `,
        [copyName, slug, template.description || null],
      );

      const newFlow = insertedFlowRows[0] as { id: number; name: string };

      const insertedVersionRows = await manager.query(
        `
          INSERT INTO flow_versions (
            flow_id,
            version_number,
            is_published,
            published_at,
            created_at,
            message,
            node_count,
            snapshot
          )
          SELECT
            $1,
            1,
            false,
            NULL,
            NOW(),
            'Imported from template #' || $2::text,
            fv.node_count,
            fv.snapshot
          FROM flow_versions fv
          WHERE fv.id = $3
          RETURNING id
        `,
        [newFlow.id, templateId, currentVersionId],
      );

      const newVersionId = Number(insertedVersionRows[0]?.id || 0);

      await manager.query(
        `
          INSERT INTO flow_nodes (
            flow_version_id,
            node_key,
            type,
            label,
            position_x,
            position_y,
            config_json,
            group_id,
            subflow_id,
            created_at
          )
          SELECT
            $1,
            fn.node_key,
            fn.type,
            fn.label,
            fn.position_x,
            fn.position_y,
            fn.config_json,
            fn.group_id,
            NULL,
            NOW()
          FROM flow_nodes fn
          WHERE fn.flow_version_id = $2
        `,
        [newVersionId, currentVersionId],
      );

      await manager.query(
        `
          INSERT INTO flow_edges (
            flow_version_id,
            source_node_key,
            target_node_key,
            branch_key,
            condition,
            created_at
          )
          SELECT
            $1,
            fe.source_node_key,
            fe.target_node_key,
            fe.branch_key,
            fe.condition,
            NOW()
          FROM flow_edges fe
          WHERE fe.flow_version_id = $2
        `,
        [newVersionId, currentVersionId],
      );

      await manager.query(
        `
          UPDATE call_flows
          SET current_version_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [newFlow.id, newVersionId],
      );

      return { id: Number(newFlow.id), name: String(newFlow.name) };
    });
  }

  private async ensureUniqueSlug(manager: DataSource['manager'], baseSlug: string): Promise<string> {
    const normalizedBase = baseSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      || 'template-copy';

    let candidate = normalizedBase;
    let suffix = 2;

    while (true) {
      const rows = await manager.query(`SELECT id FROM call_flows WHERE slug = $1 LIMIT 1`, [candidate]);
      if (!rows[0]) {
        return candidate;
      }
      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
  }
}
