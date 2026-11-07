/** Intrinsic pixel size of public/crest.png. Width and height stay in this ratio. */
const CREST_WIDTH = 303
const CREST_HEIGHT = 321

type CrestProps = {
  width: number
  alt?: string
  className?: string
}

export function Crest({ width, alt = '', className }: CrestProps) {
  const height = Math.round((width * CREST_HEIGHT) / CREST_WIDTH)
  return (
    <picture className={className}>
      <source srcSet="/crest.webp" type="image/webp" />
      <img src="/crest.png" alt={alt} width={width} height={height} />
    </picture>
  )
}
