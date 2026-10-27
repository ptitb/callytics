import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates() {
    return this.templatesService.listTemplates();
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
