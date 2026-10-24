import mongoose from 'mongoose';

// mongoose's sanitizeFilter (enabled in config/db.js) neutralises `$` operators
// inside query filters to block injection from user input. Operators the server
// builds itself from validated values are marked as trusted here.

/** { $gte: from, $lte: to } for validated values. */
export const between = (from, to) => mongoose.trusted({ $gte: from, $lte: to });
export const gte = (v) => mongoose.trusted({ $gte: v });
export const lte = (v) => mongoose.trusted({ $lte: v });
export const lt = (v) => mongoose.trusted({ $lt: v });
export const inList = (values) => mongoose.trusted({ $in: values });
export const notIn = (values) => mongoose.trusted({ $nin: values });
export const ne = (v) => mongoose.trusted({ $ne: v });
