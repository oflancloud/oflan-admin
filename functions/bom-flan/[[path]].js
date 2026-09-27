import { handle } from '../../lib/bomflan.js';
export const onRequest = ({request, env}) => handle(request, env);
