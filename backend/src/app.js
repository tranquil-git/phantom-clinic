// Ứng dụng Express của API phòng khám. Dùng chung cho server.js (máy dev, host thường) và api/index.js (Vercel).
import cookieParser from 'cookie-parser';
import express from 'express';
import { authRouter, requireAuth } from './auth.js';
import { errorHandler } from './errors.js';
import { adminRouter } from './routes/admin.js';
import { appointmentsRouter, remindersRouter } from './routes/appointments.js';
import { billingRouter } from './routes/billing.js';
import { patientsRouter } from './routes/patients.js';
import { reportsRouter } from './routes/reports.js';
import { treatmentRouter } from './routes/treatment.js';

const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
// Host production (Render, Railway…) đặt API sau một proxy HTTPS → tin header X-Forwarded-* của proxy đó
if (isProduction) app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

const api = express.Router();
api.use(requireAuth);
api.use('/patients', patientsRouter);
api.use('/appointments', appointmentsRouter);
api.use('/reminders', remindersRouter);
api.use(treatmentRouter);
api.use(billingRouter);
api.use(adminRouter);
api.use(reportsRouter);
app.use('/api', api);

app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này' }));
app.use(errorHandler);

export default app;
