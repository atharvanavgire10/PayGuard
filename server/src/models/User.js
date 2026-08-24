import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, match: /^\S+@\S+\.\S+$/ },
}, { timestamps: true })

userSchema.index({ email: 1 }, { unique: true })

export default mongoose.model('User', userSchema)
