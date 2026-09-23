#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?}"
: "${MINIO_ROOT_PASSWORD:?}"
: "${S3_API_ACCESS_KEY:?}"
: "${S3_API_SECRET_KEY:?}"
: "${S3_WORKER_ACCESS_KEY:?}"
: "${S3_WORKER_SECRET_KEY:?}"
: "${S3_ORIGINALS_BUCKET:?}"
: "${S3_THUMBNAILS_BUCKET:?}"

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "local/$S3_ORIGINALS_BUCKET" "local/$S3_THUMBNAILS_BUCKET"
mc anonymous set private "local/$S3_ORIGINALS_BUCKET"
mc anonymous set private "local/$S3_THUMBNAILS_BUCKET"

cat >/tmp/api-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:ListBucket","s3:ListBucketMultipartUploads"],"Resource":["arn:aws:s3:::$S3_ORIGINALS_BUCKET","arn:aws:s3:::$S3_THUMBNAILS_BUCKET"]},
  {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":"arn:aws:s3:::$S3_ORIGINALS_BUCKET/*"},
  {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::$S3_THUMBNAILS_BUCKET/*"}
]}
EOF
cat >/tmp/worker-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$S3_ORIGINALS_BUCKET"},
  {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::$S3_ORIGINALS_BUCKET/*"},
  {"Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::$S3_THUMBNAILS_BUCKET/*"}
]}
EOF
mc admin policy create local streamtube-video-api /tmp/api-policy.json
mc admin policy create local streamtube-video-worker /tmp/worker-policy.json
mc admin user add local "$S3_API_ACCESS_KEY" "$S3_API_SECRET_KEY"
mc admin user add local "$S3_WORKER_ACCESS_KEY" "$S3_WORKER_SECRET_KEY"
mc admin policy attach local streamtube-video-api --user "$S3_API_ACCESS_KEY"
mc admin policy attach local streamtube-video-worker --user "$S3_WORKER_ACCESS_KEY"

echo 'MinIO buckets and scoped users configured; global CORS is set by the server environment'
