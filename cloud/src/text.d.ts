// Wrangler's Text module rule (see wrangler.toml) lets us import *.txt as a
// string. This declaration teaches tsc the same.
declare module '*.txt' {
  const content: string;
  export default content;
}
