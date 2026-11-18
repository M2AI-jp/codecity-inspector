// PNG format: share the signature, channel counts and Adam7 pass order between codecs.
export const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
export const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
