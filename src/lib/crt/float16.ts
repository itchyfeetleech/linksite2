const baseBuffer = new ArrayBuffer(4);
const floatView = new Float32Array(baseBuffer);
const intView = new Uint32Array(baseBuffer);

export const float32ToFloat16 = (value: number) => {
  floatView[0] = value;
  const x = intView[0];

  const sign = (x >> 16) & 0x8000;
  const exponent = ((x >> 23) & 0xff) - 112;
  let mantissa = x & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) {
      return sign;
    }
    mantissa = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((mantissa + 0x1000) >> 13);
  }

  if (exponent === 143 - 112) {
    if (mantissa === 0) {
      return sign | 0x7c00;
    }
    mantissa >>= 13;
    return sign | 0x7c00 | mantissa | (mantissa === 0 ? 1 : 0);
  }

  if (exponent > 30) {
    return sign | 0x7c00;
  }

  return sign | (exponent << 10) | ((mantissa + 0x1000) >> 13);
};

export const float16ToFloat32 = (value: number) => {
  const sign = (value & 0x8000) << 16;
  let exponent = value & 0x7c00;
  let mantissa = value & 0x03ff;

  if (exponent === 0x7c00) {
    exponent = 0xff << 23;
    if (mantissa) {
      mantissa = mantissa << 13;
    }
  } else if (exponent !== 0) {
    exponent = (exponent + 0x1c000) << 13;
    mantissa <<= 13;
  } else if (mantissa !== 0) {
    exponent = 0x1c400000;
    while ((mantissa & 0x0400) === 0) {
      mantissa <<= 1;
      exponent -= 0x00800000;
    }
    mantissa = (mantissa & 0x03ff) << 13;
  }

  intView[0] = sign | exponent | mantissa;
  return floatView[0];
};

export const encodeFloat32To16 = (source: Float32Array) => {
  const result = new Uint16Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    result[i] = float32ToFloat16(source[i]);
  }
  return result;
};

export const decodeFloat16To32 = (source: Uint16Array) => {
  const result = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    result[i] = float16ToFloat32(source[i]);
  }
  return result;
};
