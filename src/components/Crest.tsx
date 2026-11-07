/** Intrinsic pixel size of public/crest.png. Width and height stay in this ratio. */
const CREST_WIDTH = 985
const CREST_HEIGHT = 988

/** Query so browsers drop the previous CHEETAH crest cached at these paths. */
const CREST_VERSION = '4c93e428'

type CrestProps = {
  width: number
  alt?: string
  className?: string
}

export function Crest({ width, alt = '', className }: CrestProps) {
  const height = Math.round((width * CREST_HEIGHT) / CREST_WIDTH)
  const version = `?v=${CREST_VERSION}`
  return (
    <picture className={className}>
      <source srcSet={`/crest.webp${version}`} type="image/webp" />
      <img src={`/crest.png${version}`} alt={alt} width={width} height={height} />
    </picture>
  )
}
