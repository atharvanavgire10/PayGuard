import { z } from 'zod'

export const checkoutOrderRequestSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
  }).strict(),
  items: z.array(z.object({
    sku: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(1).max(20),
  }).strict()).min(1).max(20),
}).strict()

export const paymentVerificationRequestSchema = z.object({
  razorpay_payment_id: z.string().min(1).max(255),
  razorpay_order_id: z.string().min(1).max(255),
  razorpay_signature: z.string().min(1).max(512),
}).strict()
