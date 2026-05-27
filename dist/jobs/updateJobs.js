import { updateMany } from '../operations.js';
export const updateJobs = async function updateJobs(args) {
    return updateMany.call(this, {
        collection: 'payload-jobs',
        data: args.data,
        limit: 'limit' in args ? args.limit : undefined,
        req: args.req,
        sort: 'sort' in args ? args.sort : undefined,
        where: 'where' in args ? args.where : { id: { equals: args.id } },
    });
};
