import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.model.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { User } from "../models/user.model.js"


// get all videos based on query of title and description, sort, pagination

const getAllVideos = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, query, sortBy = "createdAt", sortType = "desc", userId } = req.query;

  // Ensure page and limit are integers
  const pageInt = parseInt(page, 10);
  const limitInt = parseInt(limit, 10);

  // Construct the sort object dynamically based on sortBy and sortType
  const sort = {};
  sort[sortBy] = sortType === "desc" ? -1 : 1;

  // Start building the aggregation pipeline
  let pipeline = [
    {
      $sort: sort
    },
    {
      $skip: (pageInt - 1) * limitInt
    },
    {
      $limit: limitInt
    }
  ];

  pipeline.push(
    {
      $lookup: {
        from: "users",  // Join with the 'users' collection
        localField: "owner",  // Field in 'videos' collection that relates to 'users'
        foreignField: "_id",  // Reference the '_id' field in 'users' collection
        as: "ownerDetails",  // Alias for the joined data
        pipeline: [
          {
            $project: {
              username: 1,
              avatar: 1,
            }
          }
        ]
      }
    },
    {
      $unwind: "$ownerDetails"  // Flatten the 'ownerDetails' array
    }
  );

  if (isValidObjectId(userId)) {
    pipeline.unshift({
      $match: {
        owner: new mongoose.Types.ObjectId(userId)
      }
    })
  }

  pipeline.push({ $match: { isPublished: true } });

  // search should be first in pipeline array so unshift adds it to first if query is present
  if (query) {
    pipeline.unshift({
      $search: {
        index: "search-videos",
        text: {
          query: query,
          path: ["title", "description"]
        }
      }
    });
  }

  const videos = await Video.aggregate(pipeline);
  return res
    .status(200)
    .json(new ApiResponse(200, videos, "Videos fetched successfully"));

});

//get video, upload to cloudinary, create video
const publishAVideo = asyncHandler(async (req, res) => {
  const { title, description } = req.body

  if ([title, description].some((field) => field?.trim() === "")) {
    throw new ApiError(400, "All fields are required");
  }

  const videoLocalPath = req.files?.videoFile[0]?.path;
  const thumbnailLocalPath = req.files?.thumbnail[0]?.path;

  const videoFile = await uploadOnCloudinary(videoLocalPath)
  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath)

  if (!videoFile) {
    throw new ApiError(400, "Video file not found");
  }

  if (!thumbnail) {
    throw new ApiError(400, "Thumbnail not found");
  }

  const video = await Video.create({
    title,
    description,
    duration: videoFile.duration,
    videoFile: videoFile.url,
    thumbnail: thumbnail.url,
    owner: req.user?._id,
    isPublished: true
  });

  const videoUploaded = await Video.findById(video._id);

  if (!videoUploaded) {
    throw new ApiError(500, "videoUpload failed please try again !");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video uploaded successfully"));
})

const getVideoById = asyncHandler(async (req, res) => {
  const { videoId } = req.params

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  if (!isValidObjectId(req.user?._id)) {
    throw new ApiError(400, "Invalid userId");
  }

  // const video = await Video.findById(videoId)
  const video = await Video.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId)
      }
    },
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "likes"
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            $lookup: {
              from: "subscriptions",
              localField: "_id",
              foreignField: "channel",
              as: "subscribers",
            }
          },
          {
            $addFields: {
              subscribersCount: {
                $size: "$subscribers"
              },
              isSubscribed: {
                $cond: {
                  if: {
                    $in: [req.user?._id, "$subscribers.subscriber"]
                  },
                  then: true,
                  else: false
                }
              }
            }
          },
          {
            $project: {
              username: 1,
              avatar: 1,
              subscribersCount: 1,
              isSubscribed: 1
            }
          }
        ]
      }
    },
    {
      $addFields: {
        likesCount: {
          $size: "$likes"
        },
        owner: {
          $first: "$owner"
        },
        isLiked: {
          $cond: {
            if: { $in: [req.user?._id, "$likes.likedBy"] },
            then: true,
            else: false
          }
        }
      }
    },
    {
      $project: {
        videoFile: 1,
        title: 1,
        description: 1,
        views: 1,
        likesCount: 1,
        isLiked: 1,
        owner: 1,
        duration: 1,
        comments: 1,
        createdAt: 1,
      }
    }
  ]);

  if (!video) {
    throw new ApiError(500, "failed to fetch video");
  }

  // increment views if video fetched successfully
  await Video.findByIdAndUpdate(videoId, {
    $inc: {
      views: 1
    }
  });

  await User.findByIdAndUpdate(req.user?._id, {
    $addToSet: {
      watchHistory: videoId
    }
  });

  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video fetched successfully"));
})

//update video details like title, description, thumbnail
const updateVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params
  const { title, description } = req.body;

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid Video Id")
  }

  if (!(title && description)) {
    throw new ApiError(400, "Both title and description are required");
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(500, "failed to fetch video");
  }

  if (video?.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(
      400,
      "You can not edit this video"
    );
  }

  const thumbnailLocalPath = req.file?.path;

  if (!thumbnailLocalPath) {
    throw new ApiError(400, "thumbnail is required");
  }

  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

  if (!thumbnail) {
    throw new ApiError(400, "thumbnail not found");
  }

  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: {
        title,
        description,
        thumbnail: thumbnail.url
      }
    },
    { new: true }
  );
  if (!updatedVideo) {
    throw new ApiError(500, "Failed to update video please try again");
  }
  return res
    .status(200)
    .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
})

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid Video Id")
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(500, "failed to fetch video");
  }

  if (video?.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(
      400,
      "You can not edit this video"
    );
  }

  const deletedVideo = await Video.findByIdAndDelete(video?._id)

  if (!deletedVideo) {
    throw new ApiError(400, "Failed to delete the video");
  }

  // delete video likes
  await Like.deleteMany({
    video: videoId
  })

  // delete video comments
  await Comment.deleteMany({
    video: videoId,
  })

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Video deleted successfully"));

});

const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  if (video?.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(
      400,
      "You can not toggle publish status"
    );
  }

  const toggledVideoPublish = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: {
        isPublished: !video?.isPublished
      }
    },
    { new: true }
  );

  if (!toggledVideoPublish) {
    throw new ApiError(500, "Failed to toggle video publish status");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { isPublished: toggledVideoPublish.isPublished },
        "Video publish toggled successfully"
      )
    );

});

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus
}