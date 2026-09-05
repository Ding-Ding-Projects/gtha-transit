type Photo = {
  exactVehicle: boolean;
  sourceUrl: string;
  credit: string;
  license: string;
  licenseUrl?: string;
};

function httpsUrl(value?: string) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export default function VehiclePhotoCaption({
  photo,
  t,
}: {
  photo: Photo;
  t: (english: string, cantonese: string) => string;
}) {
  const source = httpsUrl(photo.sourceUrl);
  const license = httpsUrl(photo.licenseUrl);
  return (
    <figcaption>
      <strong>
        {photo.exactVehicle
          ? t('Exact vehicle photo', '同一架車嘅照片')
          : t(
              'Representative photo, not the assigned vehicle',
              '代表照片，並非已編配車輛',
            )}
      </strong>
      {' · '}
      {source ? (
        <a href={source} target="_blank" rel="noreferrer">
          {photo.credit}
        </a>
      ) : (
        photo.credit
      )}
      {' · '}
      {license ? (
        <a href={license} target="_blank" rel="noreferrer">
          {photo.license}
        </a>
      ) : (
        photo.license
      )}
    </figcaption>
  );
}
