import crypto from 'crypto';

const generateOTP = (): number => {
  return crypto.randomInt(100000, 1000000);
};

export default generateOTP;
