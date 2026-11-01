import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates() {
    return this.templatesService.listTemplates();
  }

  /** Saves a snapshot of an existing flow as a new template. */
  @Post()
  async createTemplate(@Body() dto: CreateTemplateDto) {
    const data = await this.templatesService.createTemplate(dto);
    return { data };
  }

  /** Deletes a template and its submenus. Regular flows are rejected with 404. */
  @Delete(':id')
  async deleteTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.templatesService.deleteTemplate(id);
    return { data };
  }

  /**
   * Creates a flow from a JSON document (export format, minimal example or GET /flows/:id shape).
   * The body is deliberately not typed as a DTO: the global whitelist pipe would reject harmless
   * extra fields such as ids, so the service sanitizes and validates it instead.
   */
  @Post('import')
  async importDocument(@Body() body: unknown) {
    const data = await this.templatesService.importDocument(body);
    return { data };
  }

  @Post(':id/import')
  async importTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.templatesService.importTemplate(id);
    return { data };
  }
}
