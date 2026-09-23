import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import { Readable } from 'node:stream';

export interface StoredPart {
  partNumber: number;
  eTag: string;
  sizeBytes: number;
}
export interface StoredObject {
  sizeBytes: number;
  eTag: string;
}

export abstract class VideoStorage {
  abstract initiate(bucket: string, key: string, mime: string): Promise<string>;
  abstract sign(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    seconds: number,
  ): Promise<string>;
  abstract listParts(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<StoredPart[]>;
  abstract complete(
    bucket: string,
    key: string,
    uploadId: string,
    parts: StoredPart[],
  ): Promise<void>;
  abstract head(bucket: string, key: string): Promise<StoredObject | null>;
  abstract read(
    bucket: string,
    key: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Readable>;
  abstract abort(bucket: string, key: string, uploadId: string): Promise<void>;
}

@Injectable()
export class S3VideoStorage extends VideoStorage {
  private readonly internal: S3Client;
  private readonly publicSigner: S3Client;

  constructor(
    @Inject(storageConfig.KEY) config: ConfigType<typeof storageConfig>,
  ) {
    super();
    const credentials = {
      accessKeyId: config.api.accessKey!,
      secretAccessKey: config.api.secretKey!,
    };
    const common = { region: config.region, forcePathStyle: true, credentials };
    this.internal = new S3Client({
      ...common,
      endpoint: config.internalEndpoint,
    });
    this.publicSigner = new S3Client({
      ...common,
      endpoint: config.publicEndpoint,
    });
  }

  async initiate(bucket: string, key: string, mime: string): Promise<string> {
    const result = await this.internal.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mime,
      }),
    );
    if (!result.UploadId) throw new Error('Missing S3 upload ID');
    return result.UploadId;
  }

  sign(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    seconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicSigner,
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: seconds },
    );
  }

  async listParts(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await this.internal.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        if (!part.PartNumber || !part.ETag || part.Size === undefined)
          throw new Error('Incomplete S3 part');
        parts.push({
          partNumber: part.PartNumber,
          eTag: part.ETag,
          sizeBytes: part.Size,
        });
      }
      truncated = page.IsTruncated ?? false;
      if (!truncated) break;
      if (
        !page.NextPartNumberMarker ||
        String(page.NextPartNumberMarker) === marker
      )
        throw new Error('Invalid S3 pagination');
      marker = String(page.NextPartNumberMarker);
    }
    return parts;
  }

  async complete(
    bucket: string,
    key: string,
    uploadId: string,
    parts: StoredPart[],
  ): Promise<void> {
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag,
          })),
        },
      }),
    );
  }

  async head(bucket: string, key: string): Promise<StoredObject | null> {
    try {
      const result = await this.internal.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (result.ContentLength === undefined || !result.ETag)
        throw new Error('Incomplete S3 object');
      return { sizeBytes: result.ContentLength, eTag: result.ETag };
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
  }

  async read(
    bucket: string,
    key: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const result = await this.internal.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
      { abortSignal: signal },
    );
    if (!(result.Body instanceof Readable))
      throw new Error('S3 object body is not a Node stream');
    return result.Body;
  }

  async abort(bucket: string, key: string, uploadId: string): Promise<void> {
    try {
      await this.internal.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return;
      throw error;
    }
  }
}
