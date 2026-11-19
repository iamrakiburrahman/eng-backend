import { Query } from 'mongoose';

class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public query: Record<string, any>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, any>) {
    this.modelQuery = modelQuery;
    this.query = query || {};
  }

  // SEARCH (FIXED)
  search(fields: string[]) {
    const searchTerm = (
      this.query.searchTerm ||
      this.query.search
    ) as string;

    if (searchTerm) {
      const conditions: any[] = fields.map((field) => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      }));

      // If both firstName and lastName are being searched, also support combined full name search
      if (fields.includes('firstName') && fields.includes('lastName')) {
        conditions.push({
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ['$firstName', ''] },
                  ' ',
                  { $ifNull: ['$lastName', ''] },
                ],
              },
              regex: searchTerm,
              options: 'i',
            },
          },
        });
      }

      this.modelQuery = this.modelQuery.find({
        $and: [
          {
            $or: conditions,
          },
        ],
      });
    }

    return this;
  }

  // FILTER
  filter() {
    const queryObj = { ...this.query };

    const excludeFields = [
      'search',
      'searchTerm',
      'searchValue',
      'sort',
      'page',
      'pageNumber',
      'userPage',
      'limit',
      'fields',
      'minPrice',
      'maxPrice',
    ];

    excludeFields.forEach((el) => delete queryObj[el]);

    const cleanedQuery = cleanObject(queryObj);

    this.modelQuery = this.modelQuery.find(cleanedQuery);

    // PRICE RANGE FILTER
    const minPrice = Number(this.query.minPrice);
    const maxPrice = Number(this.query.maxPrice);

    if (this.query.minPrice || this.query.maxPrice) {
      this.modelQuery = this.modelQuery.find({
        ...cleanedQuery,
        price: {
          ...(this.query.minPrice ? { $gte: minPrice } : {}),
          ...(this.query.maxPrice ? { $lte: maxPrice } : {}),
        },
      });
    }

    return this;
  }

  // SORT
  sort() {
    const sortField = (this.query?.sort as string) || '-createdAt';

    this.modelQuery = this.modelQuery.sort(sortField);

    return this;
  }

  // PAGINATION
  paginate() {
    const limit = Number(this.query?.limit) || 10;
    const page = Number(this.query?.page) || 1;
    const skip = (page - 1) * limit;

    this.modelQuery = this.modelQuery.skip(skip).limit(limit);

    return this;
  }

  // FIELD SELECTION
  fields() {
    const fields =
      (this.query?.fields as string)?.split(',').join(' ') || '-__v';

    this.modelQuery = this.modelQuery.select(fields);

    return this;
  }

  // POPULATE
  populate(
    populateFields: string[],
    selectFields: Record<string, string> = {}
  ) {
    this.modelQuery = this.modelQuery.populate(
      populateFields.map((field) => ({
        path: field,
        select: selectFields[field] || '',
      }))
    );

    return this;
  }

  // PAGINATION INFO
  async getPaginationInfo() {
    const filter = this.modelQuery.getFilter();

    const total = await this.modelQuery.model.countDocuments(filter);

    const limit = Number(this.query?.limit) || 10;
    const page = Number(this.query?.page || this.query?.pageNumber || this.query?.userPage) || 1;
    const totalPage = Math.ceil(total / limit) || 1;

    return {
      total,
      limit,
      page,
      totalPage,
    };
  }
}

// CLEAN OBJECT HELPER
function cleanObject(obj: Record<string, any>) {
  const cleaned: Record<string, any> = {};

  for (const key in obj) {
    const value = obj[key];

    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      value !== 'undefined' &&
      !(Array.isArray(value) && value.length === 0) &&
      !(
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      )
    ) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

export default QueryBuilder;