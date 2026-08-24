import mongoose from 'mongoose'

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error('MONGODB_URI is required to start the PayGuard API.')
  }

  await mongoose.connect(uri)
  console.log('MongoDB connected')
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect()
}

export function getDatabaseStatus() {
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
}
