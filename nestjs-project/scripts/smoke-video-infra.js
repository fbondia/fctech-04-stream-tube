const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  S3Client, HeadBucketCommand, CreateMultipartUploadCommand,
  UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, HeadObjectCommand, GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Queue } = require('bullmq');

const bucket = process.env.S3_ORIGINALS_BUCKET;
const endpoint = process.env.S3_INTERNAL_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
const region = process.env.S3_REGION;
const client = (role) => new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env[`S3_${role}_ACCESS_KEY`],
    secretAccessKey: process.env[`S3_${role}_SECRET_KEY`],
  },
});

async function main() {
  const api = client('API');
  const worker = client('WORKER');
  const queue = new Queue('video-processing', {
    connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) },
  });
  const key = `smoke/${randomUUID()}.bin`;
  const abortedKey = `smoke/${randomUUID()}-abort.bin`;
  let uploadId;
  let abortedUploadId;
  try {
    await api.send(new HeadBucketCommand({ Bucket: bucket }));
    assert.equal(await queue.client.then((redis) => redis.ping()), 'PONG');
    const created = await api.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
    uploadId = created.UploadId;
    assert.ok(uploadId);
    const signer = new S3Client({
      endpoint: publicEndpoint, region, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_API_ACCESS_KEY, secretAccessKey: process.env.S3_API_SECRET_KEY },
    });
    const signed = await getSignedUrl(signer, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: 1 }), { expiresIn: 900 });
    assert.equal(new URL(signed).host, new URL(publicEndpoint).host);
    const curlArgs = ['--silent', '--show-error', '--fail', '--connect-to', 'localhost:9000:minio:9000'];
    const result = execFileSync('curl', [...curlArgs, '-i', '-X', 'PUT', '-H', `Origin: ${process.env.S3_CORS_ALLOWED_ORIGIN}`, '--data-binary', 'smoke-video-infra', signed], { encoding: 'utf8' });
    const etag = result.match(/^etag:\s*(.+)\r?$/im)?.[1]?.trim();
    assert.ok(etag, 'presigned PUT must expose ETag');
    const cors = result.match(/^access-control-allow-origin:\s*(.+)\r?$/im)?.[1]?.trim();
    assert.equal(cors, process.env.S3_CORS_ALLOWED_ORIGIN);
    const exposed = result.match(/^access-control-expose-headers:\s*(.+)\r?$/im)?.[1]?.trim();
    assert.match(exposed ?? '', /\bETag\b/i, 'browser must be able to read ETag');
    const preflight = execFileSync('curl', [
      ...curlArgs, '-i', '-X', 'OPTIONS',
      '-H', `Origin: ${process.env.S3_CORS_ALLOWED_ORIGIN}`,
      '-H', 'Access-Control-Request-Method: PUT',
      '-H', 'Access-Control-Request-Headers: content-type',
      `${endpoint}/${bucket}/${key}`,
    ], { encoding: 'utf8' });
    assert.match(preflight, /^HTTP\/1\.1 204/m);
    assert.match(preflight, /Access-Control-Allow-Methods:\s*PUT/i);
    const parts = await api.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    assert.equal(parts.Parts?.length, 1);
    await api.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: [{ ETag: etag, PartNumber: 1 }] } }));
    uploadId = undefined;
    const head = await api.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    assert.equal(head.ContentLength, 'smoke-video-infra'.length);
    const range = await worker.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-4' }));
    assert.equal(await range.Body.transformToString(), 'smoke');
    const aborted = await api.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: abortedKey }));
    abortedUploadId = aborted.UploadId;
    await api.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: abortedKey, UploadId: abortedUploadId }));
    abortedUploadId = undefined;
    console.log('S3 multipart/presign/CORS/Range/abort and Redis ping passed');
  } finally {
    if (uploadId) await api.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    if (abortedUploadId) await api.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: abortedKey, UploadId: abortedUploadId }));
    await api.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    await queue.close();
    api.destroy();
    worker.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
