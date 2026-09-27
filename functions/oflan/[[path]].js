import { handle } from '../../lib/oflan.js';
export const onRequest = ({request, env}) => handle(request, env);
