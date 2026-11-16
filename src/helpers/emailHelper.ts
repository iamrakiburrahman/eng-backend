import nodemailer from 'nodemailer';
import config from '../config';
import { errorLogger, logger } from '../shared/logger';
import { ISendEmail } from '../types/email';
import { BrevoClient } from '@getbrevo/brevo';

// Lazy initialized Brevo client (only used in production)
let brevoClient: BrevoClient | null = null;
const getBrevoClient = () => {
     if (!brevoClient) {
          brevoClient = new BrevoClient({
               apiKey: config.email.apiKey || '',
          });
     }
     return brevoClient;
};

// Nodemailer SMTP Transporter (used in development/non-production)
const createSmtpTransporter = () => {
     return nodemailer.createTransport({
          host: config.email.host || 'smtp.gmail.com',
          port: Number(config.email.port) || 587,
          secure: Number(config.email.port) === 465,
          auth: {
               user: config.email.user,
               pass: config.email.pass,
          },
     });
};

const sendEmail = async (values: ISendEmail): Promise<void> => {
     const isProduction = config.node_env === 'production';

     try {
          if (isProduction) {
               // 🚀 Production: Use Brevo
               if (!config.email.apiKey) {
                    throw new Error('Brevo API key (API_KEY) is missing in production environment');
               }

               const brevo = getBrevoClient();
               const senderEmail = config.email.brevoFrom || config.email.from || 'no-replay@engsportsevents.co.uk';

               const result = await brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                         name: config.email.emailHeader || 'ENG Sports',
                         email: senderEmail,
                    },
                    to: [
                         {
                              email: values.to,
                         },
                    ],
                    subject: values.subject,
                    htmlContent: values.html,
               });

               logger.info(`[Brevo] Email sent successfully to ${values.to} (MessageId: ${result.messageId})`);
          } else {
               // 🛠️ Development / Non-Production: Use SMTP (NodeMailer)
               const transporter = createSmtpTransporter();
               const senderEmail = config.email.from || config.email.user || 'rakibhassan305@gmail.com';
               const senderName = config.email.emailHeader || 'Example';

               const mailOptions = {
                    from: `"${senderName}" <${senderEmail}>`,
                    to: values.to,
                    subject: values.subject,
                    html: values.html,
               };

               const info = await transporter.sendMail(mailOptions);
               logger.info(`[SMTP Nodemailer] Email sent successfully to ${values.to} (MessageId: ${info.messageId})`);
          }
     } catch (error) {
          errorLogger.error(`Error sending email to ${values.to}:`, error);
          throw error;
     }
};

export const emailHelper = {
     sendEmail,
};
