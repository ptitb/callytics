import nodemailer from 'nodemailer';
import { createMailer } from './mailer';
import { testConfig } from './testUtils';

describe('createMailer', () => {
  it('sends from and to the configured addresses with the attachment', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sendMail = jest.spyOn(transport, 'sendMail');
    const mailer = createMailer(testConfig({ to: ['a@example.com', 'b@example.com'] }), transport);

    await mailer.send({
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
      attachments: [{ filename: 'a.mp3', content: Buffer.from('x'), contentType: 'audio/mpeg' }],
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'callytics@example.com',
        to: ['a@example.com', 'b@example.com'],
        subject: 'Subject',
        attachments: [expect.objectContaining({ filename: 'a.mp3' })],
      }),
    );
  });

  it('fails when the server rejects a recipient', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    jest.spyOn(transport, 'sendMail').mockResolvedValue({ rejected: ['a@example.com'] } as never);
    await expect(createMailer(testConfig(), transport).send({ subject: 's', text: 't', html: 'h' })).rejects.toThrow('rejected');
  });

  it('fails when the transport fails', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    jest.spyOn(transport, 'sendMail').mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(createMailer(testConfig(), transport).send({ subject: 's', text: 't', html: 'h' })).rejects.toThrow('ECONNREFUSED');
  });
});
