/* A hard offset base is explicit Block-theme geometry, never a lighting filter. */

/** Width and height include the offset base. Content belongs within width-depth by height-depth. */
export const BlockPlate: React.FC<{
  width: number;
  height: number;
  radius: number;
  depth: number;
  stroke: number;
  fill: string;
  outline: string;
  /** 0 is raised; 1 presses the face onto its base. The caller supplies the clock. */
  press?: number;
}> = ({ width, height, radius, depth, stroke, fill, outline, press = 0 }) => {
  const travel = depth * Math.max(0, Math.min(1, press));
  const faceWidth = Math.max(1, width - depth - stroke);
  const faceHeight = Math.max(1, height - depth - stroke);
  return <svg data-block-plate="true" data-block-depth={depth} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}>
    <rect data-block-base="true" x={depth + stroke / 2} y={depth + stroke / 2} width={faceWidth} height={faceHeight} rx={radius} fill={outline} stroke={outline} strokeWidth={stroke} />
    <rect data-block-face="true" x={travel + stroke / 2} y={travel + stroke / 2} width={faceWidth} height={faceHeight} rx={radius} fill={fill} stroke={outline} strokeWidth={stroke} />
  </svg>;
};
